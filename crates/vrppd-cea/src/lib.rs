//! Coevolutionary Algorithm (CEA) for the specific VRPPD variant.
//!
//! Implements the two-population structure of Wang & Chen (2013) — Population
//! I for diversification, Population II for intensification — adapted for our
//! heterogeneous-fleet, point-to-point, single-objective formulation. The
//! adaptation map between the paper and our problem is described in
//! `documents/CEA_adaptation_notes.md`.

pub mod coevolve;
pub mod config;
pub mod crossover;
pub mod fitness;
pub mod local_improvement;
pub mod population;
pub mod recombination;
pub mod reproduction;
pub mod rscim;

pub use coevolve::{solve_cea, solve_cea_seeded, ConvergencePoint, Solved};
pub use config::CeaConfig;
pub use crossover::crossover;
pub use fitness::{fitness_values, roulette_select, Fitness};
pub use local_improvement::local_improve;
pub use population::{Individual, Population};
pub use recombination::recombine;
pub use reproduction::reproduce_elite;
pub use rscim::{generate_rscim, generate_rscim_seeded};
