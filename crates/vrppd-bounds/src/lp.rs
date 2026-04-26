//! LP-relaxation lower bound for the adapted MILP.
//!
//! Builds the MILP described in `documents/MILP_adaptation_notes.md` as a
//! continuous LP (every binary becomes `[0, 1]`), solves it via
//! [`good_lp`] backed by the pure-Rust [`microlp`] solver, and returns the
//! LP optimum. That value is a valid lower bound on the MILP optimum, hence
//! on any feasible solution to the actual problem.
//!
//! The same constraint set is used for all three objectives; only the
//! objective expression differs.
//!
//! Scaling: this is a dense, classical-VRP-style formulation. Variables
//! count `O(V · N²)` and constraints similarly. With `microlp` (a
//! simplex-based pure-Rust LP solver) the practical ceiling is roughly
//! `N ≤ 20`. Larger instances should use the direct-sum bound until
//! decomposition or column generation lands.

use std::collections::HashMap;

use good_lp::{
  constraint, microlp, variable, Constraint, Expression, ProblemVariables, Solution, SolverModel,
  Variable,
};

use vrppd_core::{haversine_km, Objective, Problem};

#[derive(Debug)]
pub enum BoundsError {
  /// `microlp` (or whichever backend) couldn't reach a solution. Carries
  /// the underlying error message so callers can log diagnostics.
  SolverFailed(String),
}

impl std::fmt::Display for BoundsError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      BoundsError::SolverFailed(msg) => write!(f, "LP solver failed: {msg}"),
    }
  }
}
impl std::error::Error for BoundsError {}

/// Compute the LP-relaxation lower bound for a given objective.
///
/// **EMPTY caveat.** The original MILP §2.4 expresses empty distance as
/// `total_distance − Σ y · atstumas_o`, where `atstumas_o` is the direct
/// haversine distance between order `o`'s pickup and delivery. The
/// implementation in `vrppd-core::working` instead tracks load segment by
/// segment and counts a leg as empty iff the vehicle's load was zero
/// just before the leg. For routes where pickups and deliveries
/// interleave, the implementation's *actual* loaded distance is larger
/// than the MILP's `Σ atstumas_o`, so the MILP's `Z_empty` is an *upper*
/// bound on the implementation's empty distance — exactly the wrong
/// direction for a lower bound. Until that mismatch is closed (e.g. by
/// introducing per-arc "loaded" flags in the LP), this function returns
/// the trivial `0.0` for `Objective::Empty`, the same as the
/// direct-sum bound.
pub fn lower_bound_lp(problem: &Problem, target: Objective) -> Result<f64, BoundsError> {
  if problem.orders.is_empty() || problem.vehicles.is_empty() {
    return Ok(0.0);
  }
  if matches!(target, Objective::Empty) {
    return Ok(0.0);
  }

  let mut model = build_lp(problem);
  let (objective, coeffs) = build_objective(problem, &model, target);

  let mut prog = model.vars.minimise(objective).using(microlp);
  for c in model.constraints.drain(..) {
    prog = prog.with(c);
  }
  match prog.solve() {
    Ok(sol) => {
      // Evaluate the objective in the solver's reported solution. We don't
      // depend on a solver-internal "objective value" accessor — it varies
      // across backends — and instead recompute from the variable values.
      let mut z = 0.0;
      for (var, coef) in coeffs {
        z += coef * sol.value(var);
      }
      // Numerical noise can push tiny negative values; clamp at 0 since
      // every objective is non-negative on feasible solutions.
      Ok(z.max(0.0))
    }
    Err(e) => Err(BoundsError::SolverFailed(format!("{e:?}"))),
  }
}

/// What `build_lp` returns: the variable container, the assembled
/// constraint list, the node-index helper, and the `x` flow-variable map
/// (the only family the objective construction reads later — `y`, `q`,
/// `u` are only referenced inside the constraint loop and don't need to
/// survive past it).
struct LpModel {
  vars: ProblemVariables,
  constraints: Vec<Constraint>,
  ix: NodeIndex,
  x: HashMap<(usize, usize, usize), Variable>,
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

fn build_lp(problem: &Problem) -> LpModel {
  let v_count = problem.vehicles.len();
  let n_count = problem.orders.len();
  let ix = NodeIndex {
    num_vehicles: v_count,
    num_orders: n_count,
  };

  let mut vars = ProblemVariables::new();
  let mut y: HashMap<(usize, usize), Variable> = HashMap::new();
  let mut x: HashMap<(usize, usize, usize), Variable> = HashMap::new();
  let mut q: HashMap<(usize, usize), Variable> = HashMap::new();
  let mut u: HashMap<(usize, usize), Variable> = HashMap::new();

  // y_ov ∈ [0, 1]
  for o in 0..n_count {
    for v in 0..v_count {
      y.insert((o, v), vars.add(variable().min(0.0).max(1.0)));
    }
  }
  // x_ijv ∈ [0, 1] for i, j ∈ L_v, i ≠ j
  for v in 0..v_count {
    let nodes: Vec<usize> = ix.vehicle_nodes(v).collect();
    for &i in &nodes {
      for &j in &nodes {
        if i == j {
          continue;
        }
        x.insert((i, j, v), vars.add(variable().min(0.0).max(1.0)));
      }
    }
  }
  // q_iv: 0 ≤ q ≤ MAX_LOAD on service nodes; pinned to 0 at the start.
  for v in 0..v_count {
    q.insert((ix.start(v), v), vars.add(variable().min(0.0).max(0.0)));
    for i in ix.service_nodes() {
      q.insert((i, v), vars.add(variable().min(0.0).max(1.0)));
    }
  }
  // u_iv ∈ [0, 2N]
  let mtz_max = 2.0 * n_count as f64;
  for v in 0..v_count {
    for i in ix.service_nodes() {
      u.insert((i, v), vars.add(variable().min(0.0).max(mtz_max)));
    }
  }

  let mut cons: Vec<Constraint> = Vec::new();

  // 1. Order assignment: Σ_v y_ov = 1 for every order.
  for o in 0..n_count {
    let mut sum = Expression::default();
    for v in 0..v_count {
      sum.add_mul(1.0, y[&(o, v)]);
    }
    cons.push(constraint!(sum == 1.0));
  }

  // 2. Tour start: each vehicle leaves its start at most once.
  for v in 0..v_count {
    let s = ix.start(v);
    let mut leaving = Expression::default();
    for j in ix.service_nodes() {
      if let Some(&xs) = x.get(&(s, j, v)) {
        leaving.add_mul(1.0, xs);
      }
    }
    cons.push(constraint!(leaving <= 1.0));
  }

  // 3. Order servicing: enter and leave pickup and delivery iff y_ov.
  for o in 0..n_count {
    for v in 0..v_count {
      let p = ix.pickup(o);
      let d = ix.delivery(o);
      let nodes: Vec<usize> = ix.vehicle_nodes(v).collect();

      let mut into_p = Expression::default();
      let mut out_p = Expression::default();
      let mut into_d = Expression::default();
      let mut out_d = Expression::default();
      for &k in &nodes {
        if k != p {
          if let Some(&xv) = x.get(&(k, p, v)) {
            into_p.add_mul(1.0, xv);
          }
          if let Some(&xv) = x.get(&(p, k, v)) {
            out_p.add_mul(1.0, xv);
          }
        }
        if k != d {
          if let Some(&xv) = x.get(&(k, d, v)) {
            into_d.add_mul(1.0, xv);
          }
          if let Some(&xv) = x.get(&(d, k, v)) {
            out_d.add_mul(1.0, xv);
          }
        }
      }
      let yov: Variable = y[&(o, v)];
      cons.push(constraint!(into_p == yov));
      cons.push(constraint!(out_p == yov));
      cons.push(constraint!(into_d == yov));
      cons.push(constraint!(out_d == yov));
    }
  }

  // 4. Pickup-before-delivery (MTZ-based):
  //    u_p − u_d + 2N · y_ov ≤ 2N − 1
  for o in 0..n_count {
    for v in 0..v_count {
      let p = ix.pickup(o);
      let d = ix.delivery(o);
      let mut lhs = Expression::default();
      lhs.add_mul(1.0, u[&(p, v)]);
      lhs.add_mul(-1.0, u[&(d, v)]);
      lhs.add_mul(2.0 * n_count as f64, y[&(o, v)]);
      cons.push(constraint!(lhs <= 2.0 * n_count as f64 - 1.0));
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

        // Δ_iv = +y_ov · w_o on pickup, −y_ov · w_o on delivery, 0 at start.
        let mut delta_i = Expression::default();
        if let Some(o) = ix.is_pickup(i) {
          delta_i.add_mul(1.0 / problem.orders[o].load_factor, y[&(o, v)]);
        } else if let Some(o) = ix.is_delivery(i) {
          delta_i.add_mul(-1.0 / problem.orders[o].load_factor, y[&(o, v)]);
        }

        let mut qi_expr = Expression::default();
        if i != ix.start(v) {
          qi_expr.add_mul(1.0, q[&(i, v)]);
        }

        // q_j ≥ q_i + Δ_i − M_q · (1 − x_ij)
        // ⇔ q_j − q_i − Δ_i − M_q · x_ij ≥ −M_q
        let mut lower = Expression::default();
        lower.add_mul(1.0, qj);
        lower -= qi_expr.clone();
        lower -= delta_i.clone();
        lower.add_mul(-m_q, xij);
        cons.push(constraint!(lower >= -m_q));

        // q_j ≤ q_i + Δ_i + M_q · (1 − x_ij)
        // ⇔ q_j − q_i − Δ_i + M_q · x_ij ≤ M_q
        let mut upper = Expression::default();
        upper.add_mul(1.0, qj);
        upper -= qi_expr;
        upper -= delta_i;
        upper.add_mul(m_q, xij);
        cons.push(constraint!(upper <= m_q));
      }
    }
  }

  // 6. MTZ subtour elimination across service nodes.
  let m_u = 2.0 * n_count as f64;
  for v in 0..v_count {
    let svc: Vec<usize> = ix.service_nodes().collect();
    for &i in &svc {
      for &j in &svc {
        if i == j {
          continue;
        }
        if let Some(&xij) = x.get(&(i, j, v)) {
          let mut lhs = Expression::default();
          lhs.add_mul(1.0, u[&(i, v)]);
          lhs.add_mul(-1.0, u[&(j, v)]);
          lhs.add_mul(m_u, xij);
          cons.push(constraint!(lhs <= m_u - 1.0));
        }
      }
    }
  }

  // `y`, `q`, `u` are intentionally dropped here — they're consumed only
  // by the constraint loop above.
  let _ = (y, q, u);
  LpModel {
    vars,
    constraints: cons,
    ix,
    x,
  }
}

/// Build the objective expression and a parallel `(variable, coefficient)`
/// list so the caller can recompute `Z` from the solver's reported values
/// without recursing through the same logic.
fn build_objective(
  problem: &Problem,
  m: &LpModel,
  target: Objective,
) -> (Expression, Vec<(Variable, f64)>) {
  let mut expr = Expression::default();
  let mut coeffs: Vec<(Variable, f64)> = Vec::new();

  // Distance term: Σ x_ijv · atst(i, j) · weight_v
  //
  // Arcs ending at the vehicle's start node carry no cost — the actual
  // problem doesn't model a return-to-start leg (routes end at the last
  // delivery). We keep the variables in the model so flow can balance,
  // but they don't contribute to the objective.
  for v in 0..problem.vehicles.len() {
    let weight_v = match target {
      Objective::Distance | Objective::Empty => 1.0,
      Objective::Price => problem.vehicles[v].price_km,
    };
    let nodes: Vec<usize> = m.ix.vehicle_nodes(v).collect();
    let s = m.ix.start(v);
    for &i in &nodes {
      for &j in &nodes {
        if i == j || j == s {
          continue;
        }
        let coef = weight_v * arc_distance(problem, &m.ix, v, i, j);
        let xv = m.x[&(i, j, v)];
        expr.add_mul(coef, xv);
        coeffs.push((xv, coef));
      }
    }
  }

  // EMPTY is handled by the early-return in `lower_bound_lp` (see the
  // caveat there) — we never reach this branch with Objective::Empty.

  (expr, coeffs)
}

fn arc_distance(problem: &Problem, ix: &NodeIndex, v: usize, i: usize, j: usize) -> f64 {
  let from = node_location(problem, ix, v, i);
  let to = node_location(problem, ix, v, j);
  haversine_km(from, to)
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
    assert_eq!(lower_bound_lp(&problem, Objective::Distance).unwrap(), 0.0);
    assert_eq!(lower_bound_lp(&problem, Objective::Empty).unwrap(), 0.0);
    assert_eq!(lower_bound_lp(&problem, Objective::Price).unwrap(), 0.0);
  }

  #[test]
  fn lp_distance_bound_is_at_least_loaded_legs_sum() {
    // One vehicle co-located with the pickup, one order. The LP must
    // spend at least the loaded leg `pickup → delivery`.
    let problem = Problem {
      vehicles: vec![vehicle(1, 1.0, 0.0, 0.0)],
      orders: vec![order(1, (0.0, 0.0), (0.0, 1.0))],
    };
    let lb = lower_bound_lp(&problem, Objective::Distance).unwrap();
    let loaded = haversine_km(&loc(0.0, 0.0), &loc(0.0, 1.0));
    assert!(
      lb >= loaded - 1e-6,
      "LP distance bound {lb} below loaded sum {loaded}"
    );
  }
}
