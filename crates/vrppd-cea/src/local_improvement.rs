//! Local Improvement operators (WC13 §4.2.3) — used by Population II.
//!
//! Two best-move operators picked uniformly per offspring:
//!
//! - **Reinsertion Improvement**: pick a customer (= order pickup-delivery
//!   pair) and find the route position that minimises the active objective.
//!   Apply the single best move across all (customer, alternative position)
//!   pairs.
//! - **Swap Improvement**: pick a pair of customers and exchange them.
//!   Apply the single best swap across all pairs.
//!
//! WC13 uses Osman's (1993) closed-form cost-saving expressions. We use
//! direct recompute-and-diff because (a) our heterogeneous-fleet setting
//! has a per-route price multiplier that the closed form doesn't model and
//! (b) maintaining pickup-before-delivery precedence is easier to verify
//! against the live route. Performance impact is acceptable at the problem
//! sizes of interest; if it becomes a bottleneck the closed form can be
//! reintroduced for the DISTANCE-only variant where it's correct.

use rand::Rng;

use vrppd_core::{
  Objective, OrderMatrix, Problem, StopKind, VehicleStartMatrix, WorkingSolution, WorkingStop,
};

/// Apply one round of best-move local improvement (Reinsertion or Swap,
/// chosen uniformly at random by `p_reinsertion`). The candidate is mutated
/// in place; if no improving move exists the candidate is returned
/// unchanged.
pub fn local_improve<R: Rng + ?Sized>(
  sol: &mut WorkingSolution,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
  p_reinsertion: f64,
  rng: &mut R,
) {
  let r: f64 = rng.r#gen();
  if r < p_reinsertion {
    reinsertion_best_move(sol, problem, order_mat, vstart_mat, target);
  } else {
    swap_best_move(sol, problem, order_mat, vstart_mat, target);
  }
}

#[inline]
fn objective_energy(sol: &WorkingSolution, target: Objective) -> f64 {
  match target {
    Objective::Empty => sol.empty_distance,
    Objective::Distance => sol.total_distance,
    Objective::Price => sol.total_price,
  }
}

/// For each currently-routed order, evaluate moving its (pickup, delivery)
/// pair to every other (vehicle, pickup-position, delivery-position) triple
/// in the solution. Apply the single best improving move.
pub fn reinsertion_best_move(
  sol: &mut WorkingSolution,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
) {
  let baseline = objective_energy(sol, target);

  // Collect (v_idx, order_idx) pairs currently in the solution.
  let mut candidates: Vec<(usize, usize)> = Vec::new();
  for (v_idx, route) in sol.routes.iter().enumerate() {
    for stop in &route.stops {
      if stop.kind == StopKind::Pickup {
        candidates.push((v_idx, stop.order_idx));
      }
    }
  }

  let mut best: Option<(usize, usize, usize, usize, usize, f64)> = None;
  // (from_v, order_idx, to_v, pickup_pos, delivery_pos, energy_after)

  for &(from_v, order_idx) in &candidates {
    let mut trial = sol.clone();
    // Remove the pair from its current route.
    trial.routes[from_v]
      .stops
      .retain(|s| s.order_idx != order_idx);

    for to_v in 0..problem.vehicles.len() {
      let route_len = trial.routes[to_v].stops.len();
      for pickup_pos in 0..=route_len {
        for delivery_pos in (pickup_pos + 1)..=(route_len + 1) {
          let mut variant = trial.clone();
          variant.routes[to_v].stops.insert(
            pickup_pos,
            WorkingStop {
              order_idx,
              kind: StopKind::Pickup,
            },
          );
          variant.routes[to_v].stops.insert(
            delivery_pos,
            WorkingStop {
              order_idx,
              kind: StopKind::Delivery,
            },
          );
          if !variant.is_valid(problem) {
            continue;
          }
          variant.recalculate_all(problem, order_mat, vstart_mat);
          let e = objective_energy(&variant, target);
          if e + 1e-12 < baseline && best.as_ref().is_none_or(|b| e < b.5) {
            best = Some((from_v, order_idx, to_v, pickup_pos, delivery_pos, e));
          }
        }
      }
    }
  }

  if let Some((from_v, order_idx, to_v, pickup_pos, delivery_pos, _)) = best {
    sol.routes[from_v]
      .stops
      .retain(|s| s.order_idx != order_idx);
    sol.routes[to_v].stops.insert(
      pickup_pos,
      WorkingStop {
        order_idx,
        kind: StopKind::Pickup,
      },
    );
    sol.routes[to_v].stops.insert(
      delivery_pos,
      WorkingStop {
        order_idx,
        kind: StopKind::Delivery,
      },
    );
    sol.recalculate_all(problem, order_mat, vstart_mat);
  }
}

/// For each pair of currently-routed orders, evaluate swapping them — each
/// (pickup, delivery) pair is removed from its current route and re-appended
/// to the other order's former route. Apply the single best improving swap.
pub fn swap_best_move(
  sol: &mut WorkingSolution,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
) {
  let baseline = objective_energy(sol, target);

  // Map each routed order to its current vehicle.
  let mut order_to_vehicle: Vec<Option<usize>> = vec![None; problem.orders.len()];
  for (v_idx, route) in sol.routes.iter().enumerate() {
    for stop in &route.stops {
      if stop.kind == StopKind::Pickup {
        order_to_vehicle[stop.order_idx] = Some(v_idx);
      }
    }
  }
  let routed: Vec<usize> = order_to_vehicle
    .iter()
    .enumerate()
    .filter_map(|(i, v)| v.map(|_| i))
    .collect();

  let mut best: Option<(usize, usize, f64)> = None; // (order_a, order_b, energy_after)

  for ai in 0..routed.len() {
    for bi in (ai + 1)..routed.len() {
      let oa = routed[ai];
      let ob = routed[bi];
      let va = order_to_vehicle[oa].unwrap();
      let vb = order_to_vehicle[ob].unwrap();
      if va == vb {
        // Intra-route swap: delegate to reinsertion's neighbourhood; this
        // operator handles the *inter-route* case per the paper.
        continue;
      }

      let mut variant = sol.clone();
      variant.routes[va].stops.retain(|s| s.order_idx != oa);
      variant.routes[vb].stops.retain(|s| s.order_idx != ob);
      // Append-style placement matches our existing p-SA Swap operator.
      variant.routes[va].stops.push(WorkingStop {
        order_idx: ob,
        kind: StopKind::Pickup,
      });
      variant.routes[va].stops.push(WorkingStop {
        order_idx: ob,
        kind: StopKind::Delivery,
      });
      variant.routes[vb].stops.push(WorkingStop {
        order_idx: oa,
        kind: StopKind::Pickup,
      });
      variant.routes[vb].stops.push(WorkingStop {
        order_idx: oa,
        kind: StopKind::Delivery,
      });
      if !variant.is_valid(problem) {
        continue;
      }
      variant.recalculate_all(problem, order_mat, vstart_mat);
      let e = objective_energy(&variant, target);
      if e + 1e-12 < baseline && best.as_ref().is_none_or(|b| e < b.2) {
        best = Some((oa, ob, e));
      }
    }
  }

  if let Some((oa, ob, _)) = best {
    let va = order_to_vehicle[oa].unwrap();
    let vb = order_to_vehicle[ob].unwrap();
    sol.routes[va].stops.retain(|s| s.order_idx != oa);
    sol.routes[vb].stops.retain(|s| s.order_idx != ob);
    sol.routes[va].stops.push(WorkingStop {
      order_idx: ob,
      kind: StopKind::Pickup,
    });
    sol.routes[va].stops.push(WorkingStop {
      order_idx: ob,
      kind: StopKind::Delivery,
    });
    sol.routes[vb].stops.push(WorkingStop {
      order_idx: oa,
      kind: StopKind::Pickup,
    });
    sol.routes[vb].stops.push(WorkingStop {
      order_idx: oa,
      kind: StopKind::Delivery,
    });
    sol.recalculate_all(problem, order_mat, vstart_mat);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use rand::SeedableRng;
  use rand_xoshiro::Xoshiro256StarStar;
  use vrppd_core::{Location, Order, Vehicle};

  use crate::rscim::generate_rscim;

  fn loc(lat: f64, lon: f64) -> Location {
    Location {
      hash: format!("{lat},{lon}"),
      latitude: lat,
      longitude: lon,
    }
  }

  fn vehicle(id: u32, lat: f64, lon: f64) -> Vehicle {
    Vehicle {
      id,
      start_location: loc(lat, lon),
      price_km: 1.0,
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

  /// Builds a problem and a deliberately-bad initial solution where order 1
  /// is on a far vehicle. Reinsertion should move it back to a nearer one.
  fn bad_assignment_fixture() -> (Problem, OrderMatrix, VehicleStartMatrix, WorkingSolution) {
    let problem = Problem {
      vehicles: vec![vehicle(1, 0.0, 0.0), vehicle(2, 100.0, 100.0)],
      orders: vec![
        order(1, (0.0, 0.0), (1.0, 1.0)),
        order(2, (100.0, 100.0), (101.0, 101.0)),
      ],
    };
    let order_mat = OrderMatrix::build(&problem.orders);
    let vstart_mat = VehicleStartMatrix::build(&problem.vehicles, &problem.orders);

    // Hand-roll a bad solution: vehicle 1 carries order 2 (far), vehicle 2 carries order 1 (far).
    let mut sol = WorkingSolution::empty(2);
    sol.routes[0].stops = vec![
      WorkingStop {
        order_idx: 1,
        kind: StopKind::Pickup,
      },
      WorkingStop {
        order_idx: 1,
        kind: StopKind::Delivery,
      },
    ];
    sol.routes[1].stops = vec![
      WorkingStop {
        order_idx: 0,
        kind: StopKind::Pickup,
      },
      WorkingStop {
        order_idx: 0,
        kind: StopKind::Delivery,
      },
    ];
    sol.recalculate_all(&problem, &order_mat, &vstart_mat);
    (problem, order_mat, vstart_mat, sol)
  }

  #[test]
  fn reinsertion_improves_or_keeps() {
    let (problem, order_mat, vstart_mat, mut sol) = bad_assignment_fixture();
    let before = sol.total_distance;
    reinsertion_best_move(
      &mut sol,
      &problem,
      &order_mat,
      &vstart_mat,
      Objective::Distance,
    );
    let after = sol.total_distance;
    assert!(after <= before + 1e-9);
    assert!(sol.is_valid(&problem));
  }

  #[test]
  fn swap_improves_obviously_bad_assignment() {
    let (problem, order_mat, vstart_mat, mut sol) = bad_assignment_fixture();
    let before = sol.total_distance;
    swap_best_move(
      &mut sol,
      &problem,
      &order_mat,
      &vstart_mat,
      Objective::Distance,
    );
    let after = sol.total_distance;
    assert!(
      after < before,
      "swap should improve obviously bad assignment"
    );
    assert!(sol.is_valid(&problem));
  }

  #[test]
  fn local_improve_preserves_validity_across_seeds() {
    let problem = Problem {
      vehicles: vec![vehicle(1, 0.0, 0.0), vehicle(2, 5.0, 5.0)],
      orders: vec![
        order(1, (0.0, 0.0), (1.0, 1.0)),
        order(2, (5.0, 5.0), (6.0, 6.0)),
        order(3, (2.0, 2.0), (3.0, 3.0)),
      ],
    };
    let order_mat = OrderMatrix::build(&problem.orders);
    let vstart_mat = VehicleStartMatrix::build(&problem.vehicles, &problem.orders);

    for seed in 0..20_u64 {
      let mut rng = Xoshiro256StarStar::seed_from_u64(seed);
      let mut sol = generate_rscim(
        &problem,
        &order_mat,
        &vstart_mat,
        Objective::Distance,
        &mut rng,
      );
      local_improve(
        &mut sol,
        &problem,
        &order_mat,
        &vstart_mat,
        Objective::Distance,
        0.5,
        &mut rng,
      );
      assert!(sol.is_valid(&problem));
    }
  }
}
