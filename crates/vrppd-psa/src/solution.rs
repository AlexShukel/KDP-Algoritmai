//! Internal mutable solution representation used during the SA inner loop.
//!
//! Routes are stored as `Vec<Vec<WorkingStop>>` keyed by vehicle index (not by
//! string id), and stops carry the order's index in `problem.orders` rather
//! than its public id — this avoids hash lookups inside the hot path.
//! Conversion to/from `vrppd_core::ProblemSolution` happens at solver
//! boundaries.

use std::collections::HashMap;

use vrppd_core::{Problem, ProblemSolution, RouteStop, StopKind, VehicleRoute};

use crate::matrix::{stop_node, OrderMatrix, VehicleStartMatrix};

const LOAD_TOLERANCE: f64 = 1e-6;
const EMPTY_LEG_THRESHOLD: f64 = 1e-3;
const MAX_LOAD: f64 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkingStop {
  pub order_idx: usize,
  pub kind: StopKind,
}

#[derive(Clone, Debug, Default)]
pub struct WorkingRoute {
  pub stops: Vec<WorkingStop>,
  pub total_distance: f64,
  pub empty_distance: f64,
  pub total_price: f64,
}

#[derive(Clone, Debug)]
pub struct WorkingSolution {
  pub routes: Vec<WorkingRoute>,
  pub total_distance: f64,
  pub empty_distance: f64,
  pub total_price: f64,
}

impl WorkingSolution {
  /// Build an empty solution with one (empty) route per vehicle.
  pub fn empty(num_vehicles: usize) -> Self {
    Self {
      routes: vec![WorkingRoute::default(); num_vehicles],
      total_distance: 0.0,
      empty_distance: 0.0,
      total_price: 0.0,
    }
  }

  /// Whole-solution validity. Mirrors the TS `isValidSolution` behaviour:
  /// every route must be capacity-feasible AND every order must be
  /// picked-up-then-delivered exactly once across the full solution.
  pub fn is_valid(&self, problem: &Problem) -> bool {
    let mut picked_up = vec![false; problem.orders.len()];
    let mut delivered = vec![false; problem.orders.len()];

    for route in &self.routes {
      if !route.is_capacity_feasible(problem) {
        return false;
      }
      for stop in &route.stops {
        match stop.kind {
          StopKind::Pickup => {
            if picked_up[stop.order_idx] {
              return false;
            }
            picked_up[stop.order_idx] = true;
          }
          StopKind::Delivery => {
            if !picked_up[stop.order_idx] || delivered[stop.order_idx] {
              return false;
            }
            delivered[stop.order_idx] = true;
          }
        }
      }
    }

    picked_up == delivered
  }

  /// Recompute every route's totals and the aggregate solution totals from
  /// scratch. Intended for use after structural mutations; full O(2N) but
  /// cheap because `2N` is small for the problem sizes of interest here.
  pub fn recalculate_all(
    &mut self,
    problem: &Problem,
    order_mat: &OrderMatrix,
    vstart_mat: &VehicleStartMatrix,
  ) {
    self.total_distance = 0.0;
    self.empty_distance = 0.0;
    self.total_price = 0.0;

    for (v_idx, route) in self.routes.iter_mut().enumerate() {
      route.recalculate(v_idx, problem, order_mat, vstart_mat);
      self.total_distance += route.total_distance;
      self.empty_distance += route.empty_distance;
      self.total_price += route.total_price;
    }
  }

  pub fn into_problem_solution(self, problem: &Problem) -> ProblemSolution {
    let mut routes_out: HashMap<String, VehicleRoute> = HashMap::new();
    for (v_idx, route) in self.routes.into_iter().enumerate() {
      let stops = route
        .stops
        .into_iter()
        .map(|s| RouteStop {
          order_id: problem.orders[s.order_idx].id,
          kind: s.kind,
        })
        .collect();
      routes_out.insert(
        problem.vehicles[v_idx].id.to_string(),
        VehicleRoute {
          stops,
          total_distance: route.total_distance,
          empty_distance: route.empty_distance,
          total_price: route.total_price,
        },
      );
    }
    ProblemSolution {
      routes: routes_out,
      total_distance: self.total_distance,
      empty_distance: self.empty_distance,
      total_price: self.total_price,
    }
  }
}

impl WorkingRoute {
  /// Capacity-feasibility plus pickup-before-delivery within this single
  /// route. Per-route check used both by SA's neighbour validation and by
  /// the trial-insertion logic in RCRS.
  pub fn is_capacity_feasible(&self, problem: &Problem) -> bool {
    if self.stops.is_empty() {
      return true;
    }
    let mut load = 0.0;
    let mut picked = vec![false; problem.orders.len()];

    for stop in &self.stops {
      let load_delta = 1.0 / problem.orders[stop.order_idx].load_factor;
      match stop.kind {
        StopKind::Pickup => {
          if picked[stop.order_idx] {
            return false;
          }
          picked[stop.order_idx] = true;
          load += load_delta;
        }
        StopKind::Delivery => {
          if !picked[stop.order_idx] {
            return false;
          }
          load -= load_delta;
        }
      }
      if load > MAX_LOAD + LOAD_TOLERANCE {
        return false;
      }
    }

    load.abs() < LOAD_TOLERANCE
  }

  /// Recompute this route's totals from its current `stops` list. Walks the
  /// stops once, accumulating loaded vs empty legs. The empty-leg detection
  /// matches the TS implementation exactly: a leg counts as empty iff the
  /// vehicle's load just before the leg is approximately zero.
  pub fn recalculate(
    &mut self,
    v_idx: usize,
    problem: &Problem,
    order_mat: &OrderMatrix,
    vstart_mat: &VehicleStartMatrix,
  ) {
    self.total_distance = 0.0;
    self.empty_distance = 0.0;
    self.total_price = 0.0;

    if self.stops.is_empty() {
      return;
    }

    let first = self.stops[0];
    let leg_to_first = vstart_mat.get(v_idx, first.order_idx);
    self.total_distance += leg_to_first;
    self.empty_distance += leg_to_first;

    let mut load = match first.kind {
      StopKind::Pickup => 1.0 / problem.orders[first.order_idx].load_factor,
      // First stop should be a pickup in any feasible route, but stay defensive
      // — a malformed neighbour upstream must not panic the SA loop.
      StopKind::Delivery => -1.0 / problem.orders[first.order_idx].load_factor,
    };

    for window in self.stops.windows(2) {
      let from = window[0];
      let to = window[1];
      let from_node = stop_node(from.order_idx, from.kind);
      let to_node = stop_node(to.order_idx, to.kind);
      let leg = order_mat.get(from_node, to_node);

      self.total_distance += leg;
      if load.abs() < EMPTY_LEG_THRESHOLD {
        self.empty_distance += leg;
      }

      let delta = 1.0 / problem.orders[to.order_idx].load_factor;
      load += match to.kind {
        StopKind::Pickup => delta,
        StopKind::Delivery => -delta,
      };
    }

    self.total_price = self.total_distance * problem.vehicles[v_idx].price_km;
  }
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

  fn vehicle(id: u32) -> Vehicle {
    Vehicle {
      id,
      start_location: loc(0.0, 0.0),
      price_km: 2.0,
    }
  }

  fn order(id: u32, lf: f64) -> Order {
    Order {
      id,
      pickup_location: loc(0.0, 0.0),
      delivery_location: loc(0.0, 0.0),
      load_factor: lf,
    }
  }

  #[test]
  fn empty_solution_is_valid() {
    let problem = Problem {
      vehicles: vec![vehicle(1)],
      orders: vec![order(1, 1.0)],
    };
    let sol = WorkingSolution::empty(1);
    assert!(sol.is_valid(&problem));
  }

  #[test]
  fn delivery_before_pickup_is_invalid() {
    let problem = Problem {
      vehicles: vec![vehicle(1)],
      orders: vec![order(1, 1.0)],
    };
    let mut sol = WorkingSolution::empty(1);
    sol.routes[0].stops = vec![
      WorkingStop {
        order_idx: 0,
        kind: StopKind::Delivery,
      },
      WorkingStop {
        order_idx: 0,
        kind: StopKind::Pickup,
      },
    ];
    assert!(!sol.is_valid(&problem));
  }

  #[test]
  fn capacity_overflow_is_invalid() {
    let problem = Problem {
      vehicles: vec![vehicle(1)],
      orders: vec![order(1, 2.0), order(2, 2.0), order(3, 0.5)],
    };
    let mut sol = WorkingSolution::empty(1);
    // Pick up all three orders before delivering any. Total load 0.5 + 0.5 + 2.0 = 3.0, way over 1.0.
    sol.routes[0].stops = vec![
      WorkingStop {
        order_idx: 0,
        kind: StopKind::Pickup,
      },
      WorkingStop {
        order_idx: 1,
        kind: StopKind::Pickup,
      },
      WorkingStop {
        order_idx: 2,
        kind: StopKind::Pickup,
      },
      WorkingStop {
        order_idx: 0,
        kind: StopKind::Delivery,
      },
      WorkingStop {
        order_idx: 1,
        kind: StopKind::Delivery,
      },
      WorkingStop {
        order_idx: 2,
        kind: StopKind::Delivery,
      },
    ];
    assert!(!sol.is_valid(&problem));
  }
}
