//! Shared problem model and primitives for the specific VRPPD variant.
//!
//! Independent of any napi binding. Solver crates depend on this crate only.

pub mod distance;
pub mod model;

pub use distance::haversine_km;
pub use model::{
  AlgorithmSolution, Location, Objective, Order, Problem, ProblemSolution, RouteStop, StopKind,
  Vehicle, VehicleRoute,
};
