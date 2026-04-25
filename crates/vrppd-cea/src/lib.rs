//! Coevolutionary Algorithm (CEA) for the specific VRPPD variant.
//!
//! Implements the two-population structure of Wang & Chen (2013) — Population
//! I for diversification, Population II for intensification — adapted for our
//! heterogeneous-fleet, point-to-point, single-objective formulation. The
//! adaptation map between the paper and our problem is described in
//! `documents/CEA_adaptation_notes.md`.
//!
//! This commit covers the foundation: RSCIM initial-population heuristic
//! (§4.1.2), the [`Population`] container, the rank-based fitness function
//! and roulette-wheel sampling (§4.2.5), and the Reproduction (elitism)
//! operator (§4.2.1). The remaining operators — Recombination, Local
//! Improvement, Crossover (FSCIM) — and the top-level solve loop land in
//! follow-up commits.

pub mod fitness;
pub mod population;
pub mod reproduction;
pub mod rscim;

pub use fitness::{fitness_values, roulette_select, Fitness};
pub use population::Population;
pub use reproduction::reproduce_elite;
pub use rscim::{generate_rscim, generate_rscim_seeded};
