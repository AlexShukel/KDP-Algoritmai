#![deny(clippy::all)]

//! Thin NAPI shell exposing solvers from the workspace to the TypeScript harness.
//!
//! The Rust algorithm logic lives in `vrppd-brute-force`, `vrppd-psa`, and
//! `vrppd-cea` (more crates to follow). This crate's only job is to mirror
//! the wire types as `#[napi(object)]` structs that the TS side imports
//! from `'napi-bridge'`, and to convert between those wire types and
//! `vrppd-core` types around each solver call.

mod wire;

use napi::{Error, Result, Status};
use napi_derive::napi;

use vrppd_core::Objective;
use vrppd_psa::{default_config_for, OperatorWeights, SaConfig};

pub use wire::{
  AlgorithmSolution, CeaConfig, CeaConvergencePoint, CeaSolved, Location, LowerBoundsResult,
  MilpConfig, MilpResult, Order, Problem, ProblemSolution, PsaConfig, PsaConvergencePoint,
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
  let merged_config = merge_psa_config(default_config_for(objective), &config);

  let solved = match config.as_ref().and_then(|c| c.seed) {
    // JS numbers are exact integers up to 2^53, more than enough for a seed.
    Some(seed) => {
      vrppd_psa::solve_pipeline_seeded(&core_problem, objective, merged_config, seed as u64)
    }
    None => vrppd_psa::solve_pipeline(&core_problem, objective, merged_config),
  };

  Ok(solved.into())
}

/// Run the Coevolutionary Algorithm. `target` accepts the same strings as
/// `solve_p_sa`. `config.seed` (if provided) gives a reproducible run.
#[napi]
pub fn solve_cea(problem: Problem, target: String, config: Option<CeaConfig>) -> Result<CeaSolved> {
  let objective = parse_target(&target)?;
  let core_problem: vrppd_core::Problem = problem.into();
  let merged_config = merge_cea_config(vrppd_cea::CeaConfig::default(), &config);

  let solved = match config.as_ref().and_then(|c| c.seed) {
    Some(seed) => vrppd_cea::solve_cea_seeded(&core_problem, objective, merged_config, seed as u64),
    None => vrppd_cea::solve_cea(&core_problem, objective, merged_config),
  };

  Ok(solved.into())
}

/// Direct-sum lower bound for all three objectives in one O(N) pass.
/// EMPTY's component is always 0 by construction (see
/// `documents/MILP_adaptation_notes.md`); kept in the result for symmetry
/// with the other two objectives.
#[napi]
pub fn lower_bound_direct(problem: Problem) -> LowerBoundsResult {
  let core_problem: vrppd_core::Problem = problem.into();
  vrppd_bounds::lower_bound_direct(&core_problem).into()
}

/// LP-relaxation lower bound for one objective. EMPTY is documented as
/// returning the trivial `0` because the implementation's load-aware
/// empty distance is not bound by the §2.4 formula — callers wanting a
/// non-trivial bound on EMPTY should fall through to `lowerBoundDirect`
/// (which also returns 0) and rely on metaheuristic upper bounds.
#[napi]
pub fn lower_bound_lp(problem: Problem, target: String) -> Result<f64> {
  let objective = parse_target(&target)?;
  let core_problem: vrppd_core::Problem = problem.into();
  vrppd_bounds::lower_bound_lp(&core_problem, objective)
    .map_err(|e| Error::new(Status::GenericFailure, format!("LP solver: {e}")))
}

/// Exact MILP via the bundled HiGHS solver. `target` accepts the same
/// strings as the metaheuristic bindings; `EMPTY` is rejected because
/// the MILP formulation models a different EMPTY than the
/// implementation (see `documents/MILP_adaptation_notes.md`).
#[napi]
pub fn solve_milp(
  problem: Problem,
  target: String,
  config: Option<MilpConfig>,
) -> Result<MilpResult> {
  let objective = parse_target(&target)?;
  let core_problem: vrppd_core::Problem = problem.into();
  let timeout = match config.as_ref().and_then(|c| c.timeout_ms) {
    Some(ms) if ms > 0.0 => std::time::Duration::from_millis(ms as u64),
    _ => vrppd_milp::DEFAULT_TIMEOUT,
  };

  match vrppd_milp::solve_milp(&core_problem, objective, timeout) {
    Ok(r) => Ok(MilpResult {
      value: r.objective_value,
      status: match r.status {
        vrppd_milp::MilpStatus::Optimal => "OPTIMAL".to_string(),
        vrppd_milp::MilpStatus::TimedOut => "TIMEDOUT".to_string(),
      },
      solve_time_ms: r.solve_time_ms as f64,
    }),
    Err(e) => Err(Error::new(Status::GenericFailure, format!("MILP: {e}"))),
  }
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

fn merge_psa_config(mut base: SaConfig, overrides: &Option<PsaConfig>) -> SaConfig {
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

fn merge_cea_config(
  mut base: vrppd_cea::CeaConfig,
  overrides: &Option<CeaConfig>,
) -> vrppd_cea::CeaConfig {
  let Some(o) = overrides.as_ref() else {
    return base;
  };
  if let Some(v) = o.population_size {
    base.population_size = v.max(1) as usize;
  }
  if let Some(v) = o.conv_count {
    base.conv_count = v as usize;
  }
  // `wall_time_cap_ms = Some(0)` from JS means "no cap" rather than
  // "terminate immediately" — the latter would make the call useless.
  if let Some(v) = o.wall_time_cap_ms {
    base.wall_time_cap_ms = if v <= 0.0 { None } else { Some(v as u64) };
  }
  if let Some(v) = o.recombination_fraction_low {
    base.recombination_fraction_low = v;
  }
  if let Some(v) = o.recombination_fraction_high {
    base.recombination_fraction_high = v;
  }
  if let Some(v) = o.p_reinsertion {
    base.p_reinsertion = v;
  }
  if let Some(v) = o.p_crossover {
    base.p_crossover = v;
  }
  base
}
