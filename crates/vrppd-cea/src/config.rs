//! CEA hyperparameters.
//!
//! Defaults follow Wang & Chen (2013) §5.1 / Table 1 except where the
//! adaptation notes call out a deviation. Population sizes default to 50 each
//! and convergence to 500 stagnant generations.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CeaConfig {
  /// Population size for both Pop I (diversification) and Pop II
  /// (intensification). The paper uses `SIZE_POP1 = SIZE_POP2 = 50`.
  pub population_size: usize,

  /// Number of consecutive generations without improvement of the global
  /// best before declaring convergence. WC13 default = 500.
  pub conv_count: usize,

  /// Optional wall-time cap in milliseconds. `None` means no cap. The paper
  /// uses 30 minutes (= 1 800 000 ms).
  pub wall_time_cap_ms: Option<u64>,

  /// Recombination removal-fraction range. Per WC13 §4.2.2 the fraction is
  /// sampled uniformly on `[1/10, 1/2]` per offspring.
  pub recombination_fraction_low: f64,
  pub recombination_fraction_high: f64,

  /// Probability that Pop II's local-improvement step uses Reinsertion (vs
  /// Swap). WC13 §4.2.3 says "either one" without further detail; we
  /// uniform-pick at 0.5.
  pub p_reinsertion: f64,

  /// Fraction of Pop II offspring produced by Crossover (vs by Local
  /// Improvement on a single parent). Not pinned by WC13; default 0.5
  /// gives equal weight to both pathways.
  pub p_crossover: f64,
}

impl Default for CeaConfig {
  fn default() -> Self {
    Self {
      population_size: 50,
      conv_count: 500,
      wall_time_cap_ms: Some(30 * 60 * 1000),
      recombination_fraction_low: 0.1,
      recombination_fraction_high: 0.5,
      p_reinsertion: 0.5,
      p_crossover: 0.5,
    }
  }
}

impl CeaConfig {
  /// A small-budget variant intended for tests and the small-instance
  /// fixtures: tiny populations, short convergence horizon.
  pub fn small_for_tests() -> Self {
    Self {
      population_size: 10,
      conv_count: 50,
      wall_time_cap_ms: Some(5_000),
      ..Self::default()
    }
  }
}
