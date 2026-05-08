//! Direct-sum lower bound — `O(N)` from problem data.
//!
//! See `documents/MILP_adaptation_notes.md` for the derivation. The bound
//! per objective is:
//!
//! - `EMPTY    → 0`
//!   Every leg of a feasible solution can in principle be loaded; the
//!   trivial bound on empty distance is zero.
//! - `DISTANCE → Σ_{o ∈ O} haversine(pickup_o, delivery_o)`
//!   Every order's pickup-to-delivery leg is unavoidable; everything else
//!   (start-to-first-pickup leg, any deadhead) can in principle be zero.
//! - `PRICE    → min_{v ∈ V} priceKm_v · LB_direct(DISTANCE)`
//!   The cheapest vehicle could in principle absorb every loaded
//!   kilometre; PRICE is at least that.
//!
//! All three values are valid lower bounds in the strict sense:
//! `optimum_objective ≥ LB_direct(objective)`. They are intentionally
//! loose — the LP-relaxation bound (next session) will be tighter.

use vrppd_core::{haversine_km, Objective, Problem};

/// One direct-sum lower bound per objective. Values are non-negative and
/// finite for any non-empty problem; for an empty problem all three are 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LowerBounds {
  pub empty: f64,
  pub distance: f64,
  pub price: f64,
}

impl LowerBounds {
  pub fn for_objective(&self, target: Objective) -> f64 {
    match target {
      Objective::Empty => self.empty,
      Objective::Distance => self.distance,
      Objective::Price => self.price,
    }
  }
}

/// Compute the direct-sum bound for every objective in one pass.
pub fn lower_bound_direct(problem: &Problem) -> LowerBounds {
  if problem.orders.is_empty() {
    return LowerBounds {
      empty: 0.0,
      distance: 0.0,
      price: 0.0,
    };
  }

  let total_loaded: f64 = problem
    .orders
    .iter()
    .map(|o| haversine_km(&o.pickup_location, &o.delivery_location))
    .sum();

  let min_price_km = problem
    .vehicles
    .iter()
    .map(|v| v.price_km)
    .fold(f64::INFINITY, f64::min);

  // `min_price_km == INFINITY` happens only when there are no vehicles,
  // in which case PRICE has no feasible solution and any non-negative
  // bound is vacuously valid. Use 0.0 rather than ∞ so the value can be
  // safely consumed by RPD math downstream.
  let price = if min_price_km.is_finite() {
    min_price_km * total_loaded
  } else {
    0.0
  };

  LowerBounds {
    empty: 0.0,
    distance: total_loaded,
    price,
  }
}

/// Convenience for callers that only want one objective.
pub fn lower_bound_for(problem: &Problem, target: Objective) -> f64 {
  lower_bound_direct(problem).for_objective(target)
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

  fn vehicle(id: u32, price_km: f64) -> Vehicle {
    Vehicle {
      id,
      start_location: loc(0.0, 0.0),
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
  fn empty_problem_has_zero_bounds() {
    let problem = Problem {
      vehicles: vec![],
      orders: vec![],
    };
    let lb = lower_bound_direct(&problem);
    assert_eq!(
      lb,
      LowerBounds {
        empty: 0.0,
        distance: 0.0,
        price: 0.0
      }
    );
  }

  #[test]
  fn distance_bound_is_sum_of_loaded_legs() {
    let problem = Problem {
      vehicles: vec![vehicle(1, 2.0)],
      orders: vec![
        order(1, (0.0, 0.0), (0.0, 1.0)),   // ~111 km
        order(2, (10.0, 0.0), (10.0, 2.0)), // ~221 km
      ],
    };
    let lb = lower_bound_direct(&problem);

    let expected =
      haversine_km(&loc(0.0, 0.0), &loc(0.0, 1.0)) + haversine_km(&loc(10.0, 0.0), &loc(10.0, 2.0));
    assert!((lb.distance - expected).abs() < 1e-9);
  }

  #[test]
  fn price_bound_uses_cheapest_vehicle() {
    let problem = Problem {
      vehicles: vec![vehicle(1, 2.0), vehicle(2, 1.5), vehicle(3, 3.0)],
      orders: vec![order(1, (0.0, 0.0), (0.0, 1.0))],
    };
    let lb = lower_bound_direct(&problem);

    let leg = haversine_km(&loc(0.0, 0.0), &loc(0.0, 1.0));
    assert!((lb.price - 1.5 * leg).abs() < 1e-9);
  }

  #[test]
  fn empty_bound_is_zero() {
    let problem = Problem {
      vehicles: vec![vehicle(1, 1.0)],
      orders: vec![order(1, (0.0, 0.0), (5.0, 5.0))],
    };
    let lb = lower_bound_direct(&problem);
    assert_eq!(lb.empty, 0.0);
  }

  #[test]
  fn for_objective_dispatches_correctly() {
    let problem = Problem {
      vehicles: vec![vehicle(1, 2.0)],
      orders: vec![order(1, (0.0, 0.0), (0.0, 1.0))],
    };
    let lb = lower_bound_direct(&problem);
    assert_eq!(lb.for_objective(Objective::Empty), lb.empty);
    assert_eq!(lb.for_objective(Objective::Distance), lb.distance);
    assert_eq!(lb.for_objective(Objective::Price), lb.price);
  }
}
