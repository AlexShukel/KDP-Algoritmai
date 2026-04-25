#![deny(clippy::all)]

//! Thin NAPI shell exposing solvers from the workspace to the TypeScript harness.
//!
//! The Rust algorithm logic lives in `vrppd-brute-force` (and future solver
//! crates). This crate's only job is to mirror the wire types as
//! `#[napi(object)]` structs that the TS side imports from `'napi-bridge'`,
//! and to convert between those wire types and `vrppd-core` types around each
//! solver call.

mod wire;

use napi_derive::napi;

pub use wire::{
  AlgorithmSolution, Location, Order, Problem, ProblemSolution, RouteStop, Vehicle, VehicleRoute,
};

#[napi]
pub fn solve_brute_force(problem: Problem) -> AlgorithmSolution {
  let core_problem: vrppd_core::Problem = problem.into();
  let core_solution = vrppd_brute_force::solve(&core_problem);
  core_solution.into()
}
