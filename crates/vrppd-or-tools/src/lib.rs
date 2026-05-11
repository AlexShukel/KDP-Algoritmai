//! OR-Tools baseline crate for the adapted VRPPD. See
//! `docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md` for the
//! full design.

use std::time::Duration;
use vrppd_core::Objective;

/// 30-minute default budget per instance — matches `vrppd_milp::DEFAULT_TIMEOUT`
/// and PLAN.md §3.3.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug)]
pub enum OrToolsError {
    /// EMPTY objective is not supported — see
    /// `documents/MILP_adaptation_notes.md` §4.5.
    UnsupportedObjective(Objective),
    /// `python3` not on PATH.
    PythonNotFound,
    /// `import ortools` failed inside the subprocess.
    OrtoolsImportFailed(String),
    /// Solver returned `FAILED`, exited non-zero, or produced malformed output.
    SolverFailed(String),
    /// Python raised an unexpected exception; `error_msg` from the script.
    SolverInternal(String),
    /// CP-SAT proved the model has no feasible solution.
    Infeasible,
}

impl std::fmt::Display for OrToolsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrToolsError::UnsupportedObjective(o) => {
                write!(f, "OR-Tools does not support objective {o:?}")
            }
            OrToolsError::PythonNotFound => write!(f, "python3 not found on PATH"),
            OrToolsError::OrtoolsImportFailed(msg) => {
                write!(f, "ortools import failed: {msg}")
            }
            OrToolsError::SolverFailed(msg) => write!(f, "OR-Tools solver failed: {msg}"),
            OrToolsError::SolverInternal(msg) => {
                write!(f, "OR-Tools internal error: {msg}")
            }
            OrToolsError::Infeasible => write!(f, "Model is infeasible"),
        }
    }
}

impl std::error::Error for OrToolsError {}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OrToolsStatus {
    /// CP-SAT proved the returned `objective_value` is optimal.
    Optimal,
    /// Best-known solution found but optimality not proven. Routing's normal
    /// success state; CP-SAT's timeout-with-incumbent state.
    Feasible,
    /// No feasible solution found within the wall-clock budget.
    TimedOut,
}

#[derive(Clone, Copy, Debug)]
pub struct OrToolsResult {
    pub objective_value: f64,
    pub status: OrToolsStatus,
    pub solve_time_ms: u64,
}

#[cfg(test)]
mod type_tests {
    use super::*;
    use vrppd_core::Objective;

    #[test]
    fn error_display_includes_kind() {
        let err = OrToolsError::UnsupportedObjective(Objective::Empty);
        assert!(format!("{err}").contains("Empty"));

        let err = OrToolsError::PythonNotFound;
        assert!(format!("{err}").contains("python"));

        let err = OrToolsError::OrtoolsImportFailed("pip install ortools".into());
        assert!(format!("{err}").contains("ortools"));

        let err = OrToolsError::SolverFailed("model_invalid".into());
        assert!(format!("{err}").contains("model_invalid"));

        let err = OrToolsError::SolverInternal("KeyError: 'orders'".into());
        assert!(format!("{err}").contains("KeyError"));

        let err = OrToolsError::Infeasible;
        assert!(format!("{err}").contains("nfeasible"));
    }
}
