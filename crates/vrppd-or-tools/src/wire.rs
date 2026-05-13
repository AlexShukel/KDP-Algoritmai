//! JSON request/response types for the Python subprocess. The Python script
//! parses `SolverRequest` from stdin and writes a `SolverResponse` to stdout.

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub(crate) struct SolverRequest<'a> {
  pub solver: &'a str,    // "routing" | "cp_sat"
  pub objective: &'a str, // "DISTANCE" | "PRICE"
  pub timeout_ms: u64,
  pub threads: usize,
  pub problem: WireProblem<'a>,
}

#[derive(Serialize)]
pub(crate) struct WireProblem<'a> {
  pub vehicles: Vec<WireVehicle<'a>>,
  pub orders: Vec<WireOrder<'a>>,
}

#[derive(Serialize)]
pub(crate) struct WireVehicle<'a> {
  pub id: u32,
  pub start_lat: f64,
  pub start_lon: f64,
  pub price_km: f64,
  #[serde(skip)]
  _marker: std::marker::PhantomData<&'a ()>,
}

impl<'a> WireVehicle<'a> {
  pub fn from_core(v: &vrppd_core::Vehicle) -> Self {
    Self {
      id: v.id,
      start_lat: v.start_location.latitude,
      start_lon: v.start_location.longitude,
      price_km: v.price_km,
      _marker: std::marker::PhantomData,
    }
  }
}

#[derive(Serialize)]
pub(crate) struct WireOrder<'a> {
  pub id: u32,
  pub pickup_lat: f64,
  pub pickup_lon: f64,
  pub delivery_lat: f64,
  pub delivery_lon: f64,
  pub load_factor: f64,
  #[serde(skip)]
  _marker: std::marker::PhantomData<&'a ()>,
}

impl<'a> WireOrder<'a> {
  pub fn from_core(o: &vrppd_core::Order) -> Self {
    Self {
      id: o.id,
      pickup_lat: o.pickup_location.latitude,
      pickup_lon: o.pickup_location.longitude,
      delivery_lat: o.delivery_location.latitude,
      delivery_lon: o.delivery_location.longitude,
      load_factor: o.load_factor,
      _marker: std::marker::PhantomData,
    }
  }
}

#[derive(Deserialize, Debug)]
pub(crate) struct SolverResponse {
  pub ok: bool,
  // Success fields
  pub objective_value: Option<f64>,
  pub status: Option<String>,
  pub solver_runtime_ms: Option<u64>,
  // Failure fields
  pub error_kind: Option<String>,
  pub error_msg: Option<String>,
}
