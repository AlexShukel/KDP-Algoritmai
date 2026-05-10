//! Warm-start decoder for the MILP solver.
//!
//! Converts a [`vrppd_core::ProblemSolution`] (e.g. PSA output) into a flat
//! column-value vector compatible with `highs::Model::set_solution`. The
//! vector is indexed exactly as the columns were added in `build_milp`:
//!
//!   1. y_ov (binary: order o assigned to vehicle v)
//!   2. x_ijv (binary: arc i → j used by vehicle v)
//!   3. q_iv (continuous: load at node i for vehicle v)
//!   4. u_iv (continuous: MTZ position of node i for vehicle v)
//!
//! If the warm start is infeasible or incomplete HiGHS silently discards
//! it — no error is propagated.

use vrppd_core::{Problem, ProblemSolution, StopKind};

use crate::ModelLayout;

/// Decode `warm_start` into a flat `Vec<f64>` of length `layout.num_cols`.
///
/// Entries that the warm start doesn't determine (e.g. unused vehicle arcs)
/// are left at 0.0, which is a valid lower bound for every column.
pub(crate) fn decode(
  problem: &Problem,
  warm_start: &ProblemSolution,
  layout: &ModelLayout,
) -> Vec<f64> {
  let mut vals = vec![0.0_f64; layout.num_cols];

  // Build lookup tables: id → index in problem slices.
  let vehicle_index_for: std::collections::HashMap<u32, usize> = problem
    .vehicles
    .iter()
    .enumerate()
    .map(|(i, v)| (v.id, i))
    .collect();

  let order_index_for: std::collections::HashMap<u32, usize> = problem
    .orders
    .iter()
    .enumerate()
    .map(|(i, o)| (o.id, i))
    .collect();

  let ix = &layout.ix;

  for (vehicle_id_str, route) in &warm_start.routes {
    // Parse the vehicle id (stored as stringified u32).
    let vehicle_id: u32 = match vehicle_id_str.parse() {
      Ok(id) => id,
      Err(_) => continue,
    };
    let v = match vehicle_index_for.get(&vehicle_id) {
      Some(&vi) => vi,
      None => continue,
    };

    if route.stops.is_empty() {
      continue;
    }

    // Resolve stop nodes: (node_index, order_index) for each stop.
    let stop_nodes: Vec<(usize, usize)> = route
      .stops
      .iter()
      .filter_map(|s| {
        let o = *order_index_for.get(&s.order_id)?;
        let node = match s.kind {
          StopKind::Pickup => ix.pickup(o),
          StopKind::Delivery => ix.delivery(o),
        };
        Some((node, o))
      })
      .collect();

    // ----------------------------------------------------------------
    // y_ov: set to 1 for each order that this vehicle serves.
    // ----------------------------------------------------------------
    for s in &route.stops {
      if s.kind == StopKind::Pickup {
        if let Some(&o) = order_index_for.get(&s.order_id) {
          if let Some(&col) = layout.y.get(&(o, v)) {
            vals[col] = 1.0;
          }
        }
      }
    }

    // ----------------------------------------------------------------
    // x_ijv: arcs along the route.
    // Arc from vehicle start → first service node.
    // Arcs between consecutive service nodes.
    // Arc from last service node → vehicle start (closing arc, zero cost
    // but still a model variable).
    // ----------------------------------------------------------------
    if !stop_nodes.is_empty() {
      let s_node = ix.start(v);
      let first_node = stop_nodes[0].0;

      // start → first stop
      if let Some(&col) = layout.x.get(&(s_node, first_node, v)) {
        vals[col] = 1.0;
      }

      // consecutive stop arcs
      for w in stop_nodes.windows(2) {
        let i = w[0].0;
        let j = w[1].0;
        if let Some(&col) = layout.x.get(&(i, j, v)) {
          vals[col] = 1.0;
        }
      }

      // last stop → vehicle start (return arc)
      let last_node = stop_nodes.last().unwrap().0;
      if let Some(&col) = layout.x.get(&(last_node, s_node, v)) {
        vals[col] = 1.0;
      }
    }

    // ----------------------------------------------------------------
    // q_iv: cumulative load at each service node along the route.
    // q at the vehicle start is pinned to 0 by its column bound (upper=0)
    // so we don't need to write it explicitly.
    // ----------------------------------------------------------------
    {
      let mut load = 0.0_f64;
      for &(node, o) in &stop_nodes {
        let delta = 1.0 / problem.orders[o].load_factor;
        // Determine the stop kind from the node index.
        let kind = if ix.is_pickup(node).is_some() {
          StopKind::Pickup
        } else {
          StopKind::Delivery
        };
        load += match kind {
          StopKind::Pickup => delta,
          StopKind::Delivery => -delta,
        };
        if let Some(&col) = layout.q.get(&(node, v)) {
          vals[col] = load.max(0.0);
        }
      }
    }

    // ----------------------------------------------------------------
    // u_iv: 1-based MTZ position so u_p < u_d + 2N·y_ov (≤ 2N − 1).
    // ----------------------------------------------------------------
    for (pos, &(node, _o)) in stop_nodes.iter().enumerate() {
      // 1-based position: first stop gets u=1, second u=2, …
      let u_val = (pos + 1) as f64;
      if let Some(&col) = layout.u.get(&(node, v)) {
        vals[col] = u_val;
      }
    }
  }

  vals
}
