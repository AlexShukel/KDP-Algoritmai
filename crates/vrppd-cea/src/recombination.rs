//! Recombination operator (WC13 §4.2.2 — used by Population I).
//!
//! "The recombination operator is a remove–insert mechanism … In the first
//! step, it randomly removes 1/2 ~ 1/10 of customers from their routes.
//! Then, the reinsertion of isolated customers is done by RSCIM. The
//! existing routes are regarded as seed routes."
//!
//! Adaptation: each "customer" is a (pickup, delivery) pair, removed and
//! re-inserted as a unit so precedence is preserved by construction. The
//! cheapest-insertion criterion is the same one RSCIM uses, parameterised
//! by the active objective.

use rand::Rng;

use vrppd_core::{Objective, OrderMatrix, Problem, StopKind, VehicleStartMatrix, WorkingSolution};

use crate::rscim::insert_cheapest;

/// Sample the removal-fraction range and apply remove-then-reinsert to a
/// fresh clone of the parent. Returns the offspring.
//
// Many parameters are intentional: this is one operator in a family that
// shares the matrix / objective / config bundle. Wrapping them in a
// transient struct adds noise without simplifying the call sites.
#[allow(clippy::too_many_arguments)]
pub fn recombine<R: Rng + ?Sized>(
  parent: &WorkingSolution,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
  fraction_low: f64,
  fraction_high: f64,
  rng: &mut R,
) -> WorkingSolution {
  let mut child = parent.clone();

  // Collect the order indices currently routed.
  let mut routed: Vec<usize> = Vec::new();
  for route in &child.routes {
    for stop in &route.stops {
      if stop.kind == StopKind::Pickup {
        routed.push(stop.order_idx);
      }
    }
  }
  if routed.is_empty() {
    return child;
  }

  // Remove a uniform-random fraction in `[fraction_low, fraction_high]`.
  let frac = rng.r#gen_range(fraction_low..=fraction_high);
  let target_removals = (frac * routed.len() as f64).round() as usize;
  let target_removals = target_removals.clamp(1, routed.len());

  // Sample the removal set without replacement.
  rand_shuffle(&mut routed, rng);
  let to_remove: Vec<usize> = routed.into_iter().take(target_removals).collect();

  // Strip those orders from the routes (both pickup and delivery).
  for &o_idx in &to_remove {
    for route in &mut child.routes {
      route.stops.retain(|s| s.order_idx != o_idx);
    }
  }
  // Recompute totals on the trimmed solution before inserting.
  child.recalculate_all(problem, order_mat, vstart_mat);

  // Re-insert each removed order at its cheapest feasible position
  // against the trimmed solution (which now plays the role of "seeds").
  for o_idx in to_remove {
    insert_cheapest(&mut child, o_idx, problem, order_mat, vstart_mat, target);
  }

  child.recalculate_all(problem, order_mat, vstart_mat);
  child
}

/// Fisher–Yates in-place shuffle. Avoids pulling in `rand::seq::SliceRandom`
/// here so the dependency surface stays consistent across the crate.
fn rand_shuffle<T, R: Rng + ?Sized>(slice: &mut [T], rng: &mut R) {
  for i in (1..slice.len()).rev() {
    let j = rng.gen_range(0..=i);
    slice.swap(i, j);
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

  fn fixture() -> (Problem, OrderMatrix, VehicleStartMatrix) {
    let problem = Problem {
      vehicles: vec![
        vehicle(1, 0.0, 0.0),
        vehicle(2, 5.0, 5.0),
        vehicle(3, 10.0, 10.0),
      ],
      orders: vec![
        order(1, (0.0, 0.0), (1.0, 1.0)),
        order(2, (5.0, 5.0), (6.0, 6.0)),
        order(3, (10.0, 10.0), (11.0, 11.0)),
        order(4, (2.0, 2.0), (3.0, 3.0)),
      ],
    };
    let order_mat = OrderMatrix::build(&problem.orders);
    let vstart_mat = VehicleStartMatrix::build(&problem.vehicles, &problem.orders);
    (problem, order_mat, vstart_mat)
  }

  #[test]
  fn recombine_preserves_validity() {
    let (problem, order_mat, vstart_mat) = fixture();
    let mut rng = Xoshiro256StarStar::seed_from_u64(11);
    let parent = generate_rscim(
      &problem,
      &order_mat,
      &vstart_mat,
      Objective::Distance,
      &mut rng,
    );
    assert!(parent.is_valid(&problem));

    for _ in 0..50 {
      let child = recombine(
        &parent,
        &problem,
        &order_mat,
        &vstart_mat,
        Objective::Distance,
        0.1,
        0.5,
        &mut rng,
      );
      assert!(child.is_valid(&problem), "recombine produced invalid child");
    }
  }

  #[test]
  fn recombine_preserves_order_count() {
    let (problem, order_mat, vstart_mat) = fixture();
    let mut rng = Xoshiro256StarStar::seed_from_u64(23);
    let parent = generate_rscim(
      &problem,
      &order_mat,
      &vstart_mat,
      Objective::Distance,
      &mut rng,
    );
    let parent_orders: usize = parent
      .routes
      .iter()
      .flat_map(|r| r.stops.iter())
      .filter(|s| s.kind == StopKind::Pickup)
      .count();

    let child = recombine(
      &parent,
      &problem,
      &order_mat,
      &vstart_mat,
      Objective::Distance,
      0.1,
      0.5,
      &mut rng,
    );
    let child_orders: usize = child
      .routes
      .iter()
      .flat_map(|r| r.stops.iter())
      .filter(|s| s.kind == StopKind::Pickup)
      .count();
    assert_eq!(child_orders, parent_orders);
  }
}
