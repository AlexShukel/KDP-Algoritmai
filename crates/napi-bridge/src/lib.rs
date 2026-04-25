#![deny(clippy::all)]

//! Thin NAPI shell exposing solvers from the workspace to the TypeScript harness.
//!
//! The Rust algorithm logic lives in `vrppd-brute-force` and `vrppd-psa`
//! (more crates to follow). This crate's only job is to mirror the wire types
//! as `#[napi(object)]` structs that the TS side imports from `'napi-bridge'`,
//! and to convert between those wire types and `vrppd-core` types around each
//! solver call.

mod wire;

use napi::{Error, Result, Status};
use napi_derive::napi;

use vrppd_core::Objective;
use vrppd_psa::{default_config_for, OperatorWeights, SaConfig};

pub use wire::{
  AlgorithmSolution, Location, Order, Problem, ProblemSolution, PsaConfig, PsaConvergencePoint,
  PsaSolved, RouteStop, Vehicle, VehicleRoute,
};

#[napi]
pub fn solve_brute_force(problem: Problem) -> AlgorithmSolution {
  let core_problem: vrppd_core::Problem = problem.into();
  let core_solution = vrppd_brute_force::solve(&core_problem);
  core_solution.into()
}

/// Run the multi-thread p-SA pipeline. `target` accepts the same SCREAMING_CASE
/// strings as the TS `OptimizationTarget` enum: "EMPTY", "DISTANCE", "PRICE".
#[napi]
pub fn solve_p_sa(
  problem: Problem,
  target: String,
  config: Option<PsaConfig>,
) -> Result<PsaSolved> {
  let objective = parse_target(&target)?;
  let core_problem: vrppd_core::Problem = problem.into();
  let merged_config = merge_config(default_config_for(objective), &config);

  let solved = match config.as_ref().and_then(|c| c.seed) {
    // JS numbers are exact integers up to 2^53, more than enough for a seed.
    Some(seed) => {
      vrppd_psa::solve_pipeline_seeded(&core_problem, objective, merged_config, seed as u64)
    }
    None => vrppd_psa::solve_pipeline(&core_problem, objective, merged_config),
  };

  Ok(solved.into())
}

fn parse_target(s: &str) -> Result<Objective> {
  match s {
    "EMPTY" => Ok(Objective::Empty),
    "DISTANCE" => Ok(Objective::Distance),
    "PRICE" => Ok(Objective::Price),
    other => Err(Error::new(
      Status::InvalidArg,
      format!("unknown optimization target: {other:?} (expected EMPTY|DISTANCE|PRICE)"),
    )),
  }
}

fn merge_config(mut base: SaConfig, overrides: &Option<PsaConfig>) -> SaConfig {
  let Some(o) = overrides.as_ref() else {
    return base;
  };
  if let Some(v) = o.initial_temp {
    base.initial_temp = v;
  }
  if let Some(v) = o.cooling_rate {
    base.cooling_rate = v;
  }
  if let Some(v) = o.min_temp {
    base.min_temp = v;
  }
  if let Some(v) = o.max_iterations {
    base.max_iterations = v as u64;
  }
  if let Some(v) = o.threads {
    base.threads = v.max(1) as usize;
  }
  if let Some(v) = o.batch_size {
    base.batch_size = (v as u64).max(1);
  }
  if let Some(v) = o.sync_interval {
    base.sync_interval = (v as u64).max(1);
  }
  if let Some(v) = o.reheat_floor {
    base.reheat_floor = v;
  }
  base.weights = OperatorWeights {
    shift: o.weight_shift.unwrap_or(base.weights.shift),
    swap: o.weight_swap.unwrap_or(base.weights.swap),
    shuffle: o.weight_shuffle.unwrap_or(base.weights.shuffle),
  };
  base
}
