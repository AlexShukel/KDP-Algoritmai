//! Parallel Simulated Annealing for the specific VRPPD variant.
//!
//! Single-threaded driver in [`sa`] and a multi-thread pipeline in
//! [`pipeline`]. The mutable solution representation, distance matrices, and
//! validity / recalculation primitives live in `vrppd-core::working` and are
//! shared with the coevolutionary crate.

pub mod config;
pub mod operators;
pub mod pipeline;
pub mod rcrs;
pub mod sa;

pub use config::{default_config_for, OperatorWeights, SaConfig};
pub use pipeline::{solve_pipeline, solve_pipeline_seeded};
pub use sa::{solve, solve_seeded, ConvergencePoint, Solved};
