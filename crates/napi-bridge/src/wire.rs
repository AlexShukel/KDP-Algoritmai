//! NAPI-visible mirror types and conversions to/from `vrppd-core`.
//!
//! Field names and shapes match the TypeScript contract that
//! `import { ... } from 'napi-bridge'` produces.

use std::collections::HashMap;

use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Location {
  pub hash: String,
  pub latitude: f64,
  pub longitude: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Vehicle {
  pub id: u32,
  pub start_location: Location,
  pub price_km: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Order {
  pub id: u32,
  pub pickup_location: Location,
  pub delivery_location: Location,
  pub load_factor: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Problem {
  pub vehicles: Vec<Vehicle>,
  pub orders: Vec<Order>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct RouteStop {
  pub order_id: u32,
  #[napi(js_name = "type")]
  pub type_: String,
}

#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct VehicleRoute {
  pub stops: Vec<RouteStop>,
  pub total_distance: f64,
  pub empty_distance: f64,
  pub total_price: f64,
}

#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct ProblemSolution {
  pub routes: HashMap<String, VehicleRoute>,
  pub total_distance: f64,
  pub empty_distance: f64,
  pub total_price: f64,
}

#[napi(object)]
pub struct AlgorithmSolution {
  pub best_distance_solution: ProblemSolution,
  pub best_price_solution: ProblemSolution,
  pub best_empty_solution: ProblemSolution,
}

// ---- p-SA wire types ----

#[napi(object)]
#[derive(Clone, Debug)]
pub struct PsaConvergencePoint {
  pub time_ms: f64,
  /// Iteration index. JS receives a `number`; iterations stay well within
  /// `Number.MAX_SAFE_INTEGER` for any plausible run length.
  pub iteration: f64,
  pub total_distance: f64,
  pub empty_distance: f64,
  pub total_price: f64,
}

#[napi(object)]
pub struct PsaSolved {
  pub solution: ProblemSolution,
  pub history: Vec<PsaConvergencePoint>,
}

/// Optional per-call overrides matching the TS `SimulatedAnnealingConfig` plus
/// the multi-thread pipeline parameters. Any field left undefined falls back
/// to the per-objective tuned default.
#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct PsaConfig {
  pub initial_temp: Option<f64>,
  pub cooling_rate: Option<f64>,
  pub min_temp: Option<f64>,
  pub max_iterations: Option<f64>,
  pub seed: Option<f64>,
  pub threads: Option<u32>,
  pub batch_size: Option<f64>,
  pub sync_interval: Option<f64>,
  pub reheat_floor: Option<f64>,
  pub weight_shift: Option<f64>,
  pub weight_swap: Option<f64>,
  pub weight_shuffle: Option<f64>,
}

impl From<vrppd_psa::ConvergencePoint> for PsaConvergencePoint {
  fn from(c: vrppd_psa::ConvergencePoint) -> Self {
    Self {
      time_ms: c.time_ms,
      iteration: c.iteration as f64,
      total_distance: c.total_distance,
      empty_distance: c.empty_distance,
      total_price: c.total_price,
    }
  }
}

impl From<vrppd_psa::Solved> for PsaSolved {
  fn from(s: vrppd_psa::Solved) -> Self {
    Self {
      solution: s.solution.into(),
      history: s.history.into_iter().map(Into::into).collect(),
    }
  }
}

// --- conversions: wire -> core ---

impl From<Location> for vrppd_core::Location {
  fn from(w: Location) -> Self {
    Self {
      hash: w.hash,
      latitude: w.latitude,
      longitude: w.longitude,
    }
  }
}

impl From<Vehicle> for vrppd_core::Vehicle {
  fn from(w: Vehicle) -> Self {
    Self {
      id: w.id,
      start_location: w.start_location.into(),
      price_km: w.price_km,
    }
  }
}

impl From<Order> for vrppd_core::Order {
  fn from(w: Order) -> Self {
    Self {
      id: w.id,
      pickup_location: w.pickup_location.into(),
      delivery_location: w.delivery_location.into(),
      load_factor: w.load_factor,
    }
  }
}

impl From<Problem> for vrppd_core::Problem {
  fn from(w: Problem) -> Self {
    Self {
      vehicles: w.vehicles.into_iter().map(Into::into).collect(),
      orders: w.orders.into_iter().map(Into::into).collect(),
    }
  }
}

// --- conversions: core -> wire ---

impl From<vrppd_core::Location> for Location {
  fn from(c: vrppd_core::Location) -> Self {
    Self {
      hash: c.hash,
      latitude: c.latitude,
      longitude: c.longitude,
    }
  }
}

impl From<vrppd_core::RouteStop> for RouteStop {
  fn from(c: vrppd_core::RouteStop) -> Self {
    Self {
      order_id: c.order_id,
      type_: c.kind.as_str().to_string(),
    }
  }
}

impl From<vrppd_core::VehicleRoute> for VehicleRoute {
  fn from(c: vrppd_core::VehicleRoute) -> Self {
    Self {
      stops: c.stops.into_iter().map(Into::into).collect(),
      total_distance: c.total_distance,
      empty_distance: c.empty_distance,
      total_price: c.total_price,
    }
  }
}

impl From<vrppd_core::ProblemSolution> for ProblemSolution {
  fn from(c: vrppd_core::ProblemSolution) -> Self {
    Self {
      routes: c.routes.into_iter().map(|(k, v)| (k, v.into())).collect(),
      total_distance: c.total_distance,
      empty_distance: c.empty_distance,
      total_price: c.total_price,
    }
  }
}

impl From<vrppd_core::AlgorithmSolution> for AlgorithmSolution {
  fn from(c: vrppd_core::AlgorithmSolution) -> Self {
    Self {
      best_distance_solution: c.best_distance_solution.into(),
      best_price_solution: c.best_price_solution.into(),
      best_empty_solution: c.best_empty_solution.into(),
    }
  }
}
