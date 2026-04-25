//! Simulated-annealing hyperparameters.
//!
//! Mirrors the TS `SimulatedAnnealingConfig` plus its per-objective tuned
//! defaults. Defaults were obtained by the project's `tune-psa` sweep on the
//! 7×7 problem class (see PLAN.md §2 / project README).

use vrppd_core::Objective;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OperatorWeights {
  pub shift: f64,
  pub swap: f64,
  pub shuffle: f64,
}

impl Default for OperatorWeights {
  fn default() -> Self {
    Self {
      shift: 0.4,
      swap: 0.3,
      shuffle: 0.3,
    }
  }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SaConfig {
  pub initial_temp: f64,
  pub cooling_rate: f64,
  pub min_temp: f64,
  pub max_iterations: u64,
  pub weights: OperatorWeights,
}

/// Tuned defaults per objective. Same numbers as the TS worker's
/// `getDefaultConfig`.
pub fn default_config_for(target: Objective) -> SaConfig {
  match target {
    Objective::Empty => SaConfig {
      initial_temp: 500.0,
      cooling_rate: 0.99,
      min_temp: 0.1,
      max_iterations: 1_000,
      weights: OperatorWeights::default(),
    },
    Objective::Distance => SaConfig {
      initial_temp: 500.0,
      cooling_rate: 0.999,
      min_temp: 0.1,
      max_iterations: 10_000,
      weights: OperatorWeights::default(),
    },
    Objective::Price => SaConfig {
      initial_temp: 1500.0,
      cooling_rate: 0.999,
      min_temp: 0.1,
      max_iterations: 10_000,
      weights: OperatorWeights::default(),
    },
  }
}
