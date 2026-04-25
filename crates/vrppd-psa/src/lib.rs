//! Parallel Simulated Annealing for the specific VRPPD variant.
//!
//! This crate currently provides a **single-threaded** driver: RCRS initial
//! solution, three neighbour operators (Shift / Swap / Intra-Shuffle), and a
//! Metropolis-with-geometric-cooling loop. The multi-thread pipeline (island
//! migration via channels) lands in a follow-up commit per PLAN.md §1.1.

pub mod config;
pub mod matrix;
pub mod operators;
pub mod rcrs;
pub mod sa;
pub mod solution;

pub use config::{default_config_for, SaConfig};
pub use sa::{solve, solve_seeded, ConvergencePoint, Solved};
