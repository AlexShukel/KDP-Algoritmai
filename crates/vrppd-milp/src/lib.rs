//! Exact MILP solver for the adapted VRPPD variant.
//!
//! Builds the MILP from `documents/MILP_adaptation_notes.md` with full
//! integrality (`y_ov`, `x_ijv ∈ {0,1}`) and solves it via the bundled
//! HiGHS branch-and-cut solver. Used as a baseline / ground-truth for
//! N up to ~30 with a configurable wall-clock timeout per PLAN.md §3.3.
//!
//! ## Why this crate exists separately from `vrppd-bounds`
//!
//! `vrppd-bounds` solves the LP *relaxation* via the pure-Rust `microlp`
//! backend — it's a lower bound, not a proven optimum. This crate solves
//! the same model with full integrality via HiGHS. Two different
//! solvers, two different semantics, two different scaling behaviours.
//!
//! ## Why HiGHS, accessed directly (not via `good_lp`)
//!
//! - HiGHS is MIT-licensed, fast on the small VRP instances we target,
//!   and bundle-able from source via `cmake` (no external installation
//!   on the developer's box).
//! - We use the `highs` crate directly because we need access to the
//!   solver's *model status* (Optimal vs TimeLimit vs Infeasible) and
//!   the `good_lp` 1.15 wrapper does not surface either. Going direct
//!   keeps the crate small.
//!
//! ## Objective coverage
//!
//! `DISTANCE` and `PRICE` are supported — the MILP optimum should match
//! the brute-force optimum on small fixtures (verified by the tests in
//! `tests/bf_match.rs`).
//!
//! `EMPTY` is **not** supported. The original §2.4 formula
//! `Z_empty = total − Σ_o y_ov · atstumas_o` is an *upper* bound on the
//! implementation's load-aware empty distance (the implementation
//! re-tracks load segment by segment and counts a leg as empty iff the
//! vehicle's load was zero at that leg). Solving the MILP for `Z_empty`
//! would not match the brute-force optimum for `Objective::Empty` —
//! they're different quantities. Until a load-aware EMPTY formulation
//! lands, callers asking for EMPTY get
//! `MilpError::UnsupportedObjective`.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use highs::{HighsModelStatus, RowProblem, Sense};
use vrppd_core::{haversine_km, Objective, Problem};

/// 30-minute default budget per instance — matches PLAN.md §3.3.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug)]
pub enum MilpError {
  /// HiGHS reported a status we don't translate (e.g. `Unbounded` —
  /// shouldn't happen on this model since the objective is non-negative
  /// over a bounded feasible region, but we surface it rather than
  /// pretending we got an answer).
  SolverFailed(String),
  /// The model is infeasible. For the adapted MILP this can only
  /// happen if the problem itself is degenerate (no vehicles or no
  /// orders is handled separately and returns 0).
  Infeasible,
  /// EMPTY is not supported — see the module-level doc comment.
  UnsupportedObjective(Objective),
}

impl std::fmt::Display for MilpError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      MilpError::SolverFailed(msg) => write!(f, "HiGHS failed: {msg}"),
      MilpError::Infeasible => write!(f, "MILP is infeasible"),
      MilpError::UnsupportedObjective(o) => {
        write!(f, "MILP for objective {o:?} is not supported (see docs)")
      }
    }
  }
}
impl std::error::Error for MilpError {}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MilpStatus {
  /// HiGHS proved the returned `objective_value` is optimal.
  Optimal,
  /// The wall-clock budget elapsed before optimality was proven.
  /// `objective_value` is the best primal incumbent found in time;
  /// the dual bound is not surfaced here (the `highs` crate 1.x
  /// doesn't wrap `getMipDualBound`). Pair with `vrppd_bounds::lower_bound_lp`
  /// for a separate lower bound if a gap is needed.
  TimedOut,
}

#[derive(Clone, Copy, Debug)]
pub struct MilpResult {
  pub objective_value: f64,
  pub status: MilpStatus,
  pub solve_time_ms: u64,
}

/// Solve the adapted MILP for `target` with a wall-clock `timeout`.
pub fn solve_milp(
  problem: &Problem,
  target: Objective,
  timeout: Duration,
) -> Result<MilpResult, MilpError> {
  if matches!(target, Objective::Empty) {
    return Err(MilpError::UnsupportedObjective(target));
  }
  if problem.orders.is_empty() || problem.vehicles.is_empty() {
    return Ok(MilpResult {
      objective_value: 0.0,
      status: MilpStatus::Optimal,
      solve_time_ms: 0,
    });
  }

  let started = Instant::now();
  let model = build_milp(problem, target);
  let mut hm = model.problem.optimise(Sense::Minimise);
  hm.set_option("time_limit", timeout.as_secs_f64());
  // Silence the solver's stdout chatter; the result struct carries
  // everything callers need.
  hm.set_option("output_flag", false);

  let solved = hm.solve();
  let status = match solved.status() {
    HighsModelStatus::Optimal => MilpStatus::Optimal,
    HighsModelStatus::ReachedTimeLimit => MilpStatus::TimedOut,
    HighsModelStatus::Infeasible => return Err(MilpError::Infeasible),
    other => return Err(MilpError::SolverFailed(format!("status={other:?}"))),
  };

  let solution = solved.get_solution();
  let mut z = 0.0;
  for (col, coef) in &model.objective_coeffs {
    z += coef * solution[*col];
  }
  Ok(MilpResult {
    // Numerical noise can push tiny negative values; clamp at 0 since
    // every supported objective is non-negative on feasible solutions.
    objective_value: z.max(0.0),
    status,
    solve_time_ms: started.elapsed().as_millis() as u64,
  })
}

/// Convenience wrapper using `DEFAULT_TIMEOUT` (30 minutes).
pub fn solve_milp_default(
  problem: &Problem,
  target: Objective,
) -> Result<MilpResult, MilpError> {
  solve_milp(problem, target, DEFAULT_TIMEOUT)
}

struct MilpModel {
  problem: RowProblem,
  /// `(column, coefficient)` pairs reproducing the objective so we can
  /// recompute `Z` from the solver's primal vector. HiGHS does not expose
  /// `getObjectiveValue` through this binding, so we do it ourselves —
  /// the `Index<Col> for Solution` impl lets us read each column's value
  /// without leaking the column's internal index.
  objective_coeffs: Vec<(highs::Col, f64)>,
}

#[derive(Clone, Copy)]
struct NodeIndex {
  num_vehicles: usize,
  num_orders: usize,
}

impl NodeIndex {
  fn start(&self, v: usize) -> usize {
    v
  }
  fn pickup(&self, o: usize) -> usize {
    self.num_vehicles + o
  }
  fn delivery(&self, o: usize) -> usize {
    self.num_vehicles + self.num_orders + o
  }
  fn is_pickup(&self, node: usize) -> Option<usize> {
    let lo = self.num_vehicles;
    let hi = lo + self.num_orders;
    (lo..hi).contains(&node).then(|| node - lo)
  }
  fn is_delivery(&self, node: usize) -> Option<usize> {
    let lo = self.num_vehicles + self.num_orders;
    let hi = lo + self.num_orders;
    (lo..hi).contains(&node).then(|| node - lo)
  }
  fn service_nodes(&self) -> impl Iterator<Item = usize> {
    self.num_vehicles..self.num_vehicles + 2 * self.num_orders
  }
  fn vehicle_nodes(&self, v: usize) -> impl Iterator<Item = usize> {
    std::iter::once(self.start(v)).chain(self.service_nodes())
  }
}

fn build_milp(problem: &Problem, target: Objective) -> MilpModel {
  let v_count = problem.vehicles.len();
  let n_count = problem.orders.len();
  let ix = NodeIndex {
    num_vehicles: v_count,
    num_orders: n_count,
  };

  let mut pb = RowProblem::default();

  // Track the column index for every logical variable family. HiGHS gives
  // us a `Col` handle on add; we store the underlying `usize` index so
  // we can read the primal solution back later.
  let mut y: HashMap<(usize, usize), highs::Col> = HashMap::new();
  let mut x: HashMap<(usize, usize, usize), highs::Col> = HashMap::new();
  let mut q: HashMap<(usize, usize), highs::Col> = HashMap::new();
  let mut u: HashMap<(usize, usize), highs::Col> = HashMap::new();

  let mut objective_coeffs: Vec<(highs::Col, f64)> = Vec::new();

  // y_ov ∈ {0,1}. Cost = 0 (only `x` carries the objective in the
  // supported objectives — DISTANCE and PRICE).
  for o in 0..n_count {
    for v in 0..v_count {
      let col = pb.add_integer_column(0.0, 0.0..=1.0);
      y.insert((o, v), col);
    }
  }

  // x_ijv ∈ {0,1} for i, j ∈ L_v, i ≠ j. Cost = arc weight (distance
  // for DISTANCE, distance · price_km for PRICE), with the same
  // "free return-to-start" carve-out as the LP relaxation: arcs ending
  // at the vehicle's start node carry no cost in the objective because
  // the implementation does not model a return-to-start leg.
  for v in 0..v_count {
    let nodes: Vec<usize> = ix.vehicle_nodes(v).collect();
    let s = ix.start(v);
    for &i in &nodes {
      for &j in &nodes {
        if i == j {
          continue;
        }
        let cost = if j == s {
          0.0
        } else {
          arc_distance(problem, &ix, v, i, j) * objective_weight(problem, target, v)
        };
        let col = pb.add_integer_column(cost, 0.0..=1.0);
        x.insert((i, j, v), col);
        if cost != 0.0 {
          objective_coeffs.push((col, cost));
        }
      }
    }
  }

  // q_iv ∈ [0, MAX_LOAD] on service nodes; pinned to 0 at the start.
  for v in 0..v_count {
    let s_col = pb.add_column(0.0, 0.0..=0.0);
    q.insert((ix.start(v), v), s_col);
    for i in ix.service_nodes() {
      q.insert((i, v), pb.add_column(0.0, 0.0..=1.0));
    }
  }

  // u_iv ∈ [0, 2N] (MTZ position).
  let mtz_max = 2.0 * n_count as f64;
  for v in 0..v_count {
    for i in ix.service_nodes() {
      u.insert((i, v), pb.add_column(0.0, 0.0..=mtz_max));
    }
  }

  // 1. Order assignment: Σ_v y_ov = 1.
  for o in 0..n_count {
    let factors: Vec<(highs::Col, f64)> = (0..v_count).map(|v| (y[&(o, v)], 1.0)).collect();
    pb.add_row(1.0..=1.0, &factors);
  }

  // 2. Tour start: each vehicle leaves its start at most once.
  for v in 0..v_count {
    let s = ix.start(v);
    let factors: Vec<(highs::Col, f64)> = ix
      .service_nodes()
      .filter_map(|j| x.get(&(s, j, v)).copied().map(|xv| (xv, 1.0)))
      .collect();
    if !factors.is_empty() {
      pb.add_row(f64::NEG_INFINITY..=1.0, &factors);
    }
  }

  // 3. Order servicing: enter and leave pickup and delivery iff y_ov.
  //    Encoded as `Σ x = y_ov` ⇔ `Σ x − y_ov = 0`.
  for o in 0..n_count {
    for v in 0..v_count {
      let p = ix.pickup(o);
      let d = ix.delivery(o);
      let yov = y[&(o, v)];
      let nodes: Vec<usize> = ix.vehicle_nodes(v).collect();

      let mut into_p: Vec<(highs::Col, f64)> = Vec::new();
      let mut out_p: Vec<(highs::Col, f64)> = Vec::new();
      let mut into_d: Vec<(highs::Col, f64)> = Vec::new();
      let mut out_d: Vec<(highs::Col, f64)> = Vec::new();
      for &k in &nodes {
        if k != p {
          if let Some(&xv) = x.get(&(k, p, v)) {
            into_p.push((xv, 1.0));
          }
          if let Some(&xv) = x.get(&(p, k, v)) {
            out_p.push((xv, 1.0));
          }
        }
        if k != d {
          if let Some(&xv) = x.get(&(k, d, v)) {
            into_d.push((xv, 1.0));
          }
          if let Some(&xv) = x.get(&(d, k, v)) {
            out_d.push((xv, 1.0));
          }
        }
      }
      for mut row in [into_p, out_p, into_d, out_d] {
        row.push((yov, -1.0));
        pb.add_row(0.0..=0.0, &row);
      }
    }
  }

  // 4. Pickup-before-delivery (MTZ-based):
  //    u_p − u_d + 2N · y_ov ≤ 2N − 1.
  let m_n = 2.0 * n_count as f64;
  for o in 0..n_count {
    for v in 0..v_count {
      let p = ix.pickup(o);
      let d = ix.delivery(o);
      let factors = [(u[&(p, v)], 1.0), (u[&(d, v)], -1.0), (y[&(o, v)], m_n)];
      pb.add_row(f64::NEG_INFINITY..=(m_n - 1.0), factors);
    }
  }

  // 5. Capacity flow conservation, linearised. M_q = 2 covers the range
  //    `q_jv − q_iv − Δ_iv ∈ [−2, 2]` since q ∈ [0, 1] and Δ ∈ [-1, 1].
  let m_q = 2.0_f64;
  for v in 0..v_count {
    let nodes: Vec<usize> = ix.vehicle_nodes(v).collect();
    for &i in &nodes {
      for &j in &nodes {
        if i == j {
          continue;
        }
        if ix.is_pickup(j).is_none() && ix.is_delivery(j).is_none() {
          continue; // no flow into a start node
        }
        let xij = x[&(i, j, v)];
        let qj = q[&(j, v)];

        // Δ_i contribution: +w_o on pickup of o, −w_o on delivery of o.
        // w_o = 1 / load_factor_o; folded into the y_ov coefficient.
        let (delta_y_col, delta_y_coef): (Option<highs::Col>, f64) = if let Some(o) = ix.is_pickup(i) {
          (Some(y[&(o, v)]), 1.0 / problem.orders[o].load_factor)
        } else if let Some(o) = ix.is_delivery(i) {
          (Some(y[&(o, v)]), -1.0 / problem.orders[o].load_factor)
        } else {
          (None, 0.0)
        };

        // Lower side: q_j − q_i − Δ_i − M_q · x_ij ≥ −M_q
        // Upper side: q_j − q_i − Δ_i + M_q · x_ij ≤ M_q
        // (i = start ⇒ q_i = 0 by bound, so we omit the q_i term cleanly.)
        let mut lower: Vec<(highs::Col, f64)> = Vec::with_capacity(4);
        let mut upper: Vec<(highs::Col, f64)> = Vec::with_capacity(4);
        lower.push((qj, 1.0));
        upper.push((qj, 1.0));
        if i != ix.start(v) {
          lower.push((q[&(i, v)], -1.0));
          upper.push((q[&(i, v)], -1.0));
        }
        if let Some(yc) = delta_y_col {
          lower.push((yc, -delta_y_coef));
          upper.push((yc, -delta_y_coef));
        }
        lower.push((xij, -m_q));
        upper.push((xij, m_q));
        pb.add_row(-m_q..=f64::INFINITY, &lower);
        pb.add_row(f64::NEG_INFINITY..=m_q, &upper);
      }
    }
  }

  // 6. MTZ subtour elimination across service nodes:
  //    u_i − u_j + 2N · x_ij ≤ 2N − 1.
  for v in 0..v_count {
    let svc: Vec<usize> = ix.service_nodes().collect();
    for &i in &svc {
      for &j in &svc {
        if i == j {
          continue;
        }
        if let Some(&xij) = x.get(&(i, j, v)) {
          let factors = [(u[&(i, v)], 1.0), (u[&(j, v)], -1.0), (xij, m_n)];
          pb.add_row(f64::NEG_INFINITY..=(m_n - 1.0), factors);
        }
      }
    }
  }

  // `y`, `q`, `u` are intentionally dropped — only `x` (well, the column
  // indices in `objective_coeffs`) is needed past this point.
  let _ = (y, q, u);
  MilpModel {
    problem: pb,
    objective_coeffs,
  }
}

fn objective_weight(problem: &Problem, target: Objective, v: usize) -> f64 {
  match target {
    Objective::Distance | Objective::Empty => 1.0,
    Objective::Price => problem.vehicles[v].price_km,
  }
}

fn arc_distance(problem: &Problem, ix: &NodeIndex, v: usize, i: usize, j: usize) -> f64 {
  haversine_km(
    node_location(problem, ix, v, i),
    node_location(problem, ix, v, j),
  )
}

fn node_location<'a>(
  problem: &'a Problem,
  ix: &NodeIndex,
  v: usize,
  node: usize,
) -> &'a vrppd_core::Location {
  if node == ix.start(v) {
    return &problem.vehicles[v].start_location;
  }
  if let Some(o) = ix.is_pickup(node) {
    return &problem.orders[o].pickup_location;
  }
  if let Some(o) = ix.is_delivery(node) {
    return &problem.orders[o].delivery_location;
  }
  panic!("node {node} not relevant to vehicle {v}");
}

#[cfg(test)]
mod tests {
  use super::*;
  use vrppd_core::{Location, Order, Vehicle};

  fn loc(lat: f64, lon: f64) -> Location {
    Location {
      hash: format!("{lat},{lon}"),
      latitude: lat,
      longitude: lon,
    }
  }

  fn vehicle(id: u32, price_km: f64, lat: f64, lon: f64) -> Vehicle {
    Vehicle {
      id,
      start_location: loc(lat, lon),
      price_km,
    }
  }

  fn order(id: u32, p: (f64, f64), d: (f64, f64)) -> Order {
    Order {
      id,
      pickup_location: loc(p.0, p.1),
      delivery_location: loc(d.0, d.1),
      load_factor: 1.0,
    }
  }

  #[test]
  fn empty_problem_yields_zero() {
    let problem = Problem {
      vehicles: vec![],
      orders: vec![],
    };
    let r = solve_milp(&problem, Objective::Distance, Duration::from_secs(10)).unwrap();
    assert_eq!(r.objective_value, 0.0);
    assert_eq!(r.status, MilpStatus::Optimal);
  }

  #[test]
  fn empty_objective_unsupported() {
    let problem = Problem {
      vehicles: vec![vehicle(1, 1.0, 0.0, 0.0)],
      orders: vec![order(1, (0.0, 0.0), (0.0, 1.0))],
    };
    assert!(matches!(
      solve_milp(&problem, Objective::Empty, Duration::from_secs(10)),
      Err(MilpError::UnsupportedObjective(Objective::Empty))
    ));
  }
}
