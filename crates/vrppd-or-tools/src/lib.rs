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

use vrppd_core::Problem;

/// Solve the adapted VRPPD via OR-Tools Routing Solver. Returns a near-optimal
/// solution; never proves optimality (status is at most `Feasible`).
pub fn solve_routing(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError> {
    if matches!(target, Objective::Empty) {
        return Err(OrToolsError::UnsupportedObjective(target));
    }
    if problem.orders.is_empty() || problem.vehicles.is_empty() {
        return Ok(OrToolsResult {
            objective_value: 0.0,
            status: OrToolsStatus::Optimal,
            solve_time_ms: 0,
        });
    }
    // Python dispatch lands in Task 6.
    let _ = (timeout, threads);
    Err(OrToolsError::SolverFailed(
        "solve_routing: Python dispatch not yet implemented".into(),
    ))
}

/// Solve the adapted VRPPD MILP via OR-Tools CP-SAT. Can prove optimality
/// (status `Optimal`); falls back to `Feasible` or `TimedOut` on budget
/// expiry.
pub fn solve_cp_sat(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError> {
    if matches!(target, Objective::Empty) {
        return Err(OrToolsError::UnsupportedObjective(target));
    }
    if problem.orders.is_empty() || problem.vehicles.is_empty() {
        return Ok(OrToolsResult {
            objective_value: 0.0,
            status: OrToolsStatus::Optimal,
            solve_time_ms: 0,
        });
    }
    let _ = (timeout, threads);
    Err(OrToolsError::SolverFailed(
        "solve_cp_sat: Python dispatch not yet implemented".into(),
    ))
}

/// Convenience wrapper using `DEFAULT_TIMEOUT` and all available threads.
pub fn solve_routing_default(
    problem: &Problem,
    target: Objective,
) -> Result<OrToolsResult, OrToolsError> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    solve_routing(problem, target, DEFAULT_TIMEOUT, threads)
}

/// Convenience wrapper using `DEFAULT_TIMEOUT` and all available threads.
pub fn solve_cp_sat_default(
    problem: &Problem,
    target: Objective,
) -> Result<OrToolsResult, OrToolsError> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    solve_cp_sat(problem, target, DEFAULT_TIMEOUT, threads)
}

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

#[cfg(test)]
mod shortcircuit_tests {
    use super::*;
    use vrppd_core::{Location, Objective, Order, Problem, Vehicle};

    fn loc(lat: f64, lon: f64) -> Location {
        Location {
            hash: format!("{lat},{lon}"),
            latitude: lat,
            longitude: lon,
        }
    }

    fn one_vehicle_one_order() -> Problem {
        Problem {
            vehicles: vec![Vehicle {
                id: 1,
                start_location: loc(0.0, 0.0),
                price_km: 1.0,
            }],
            orders: vec![Order {
                id: 1,
                pickup_location: loc(0.0, 0.0),
                delivery_location: loc(0.0, 0.5),
                load_factor: 1.0,
            }],
        }
    }

    #[test]
    fn empty_problem_routing_returns_zero_optimal() {
        let p = Problem { vehicles: vec![], orders: vec![] };
        let r = solve_routing(&p, Objective::Distance, Duration::from_secs(1), 1).unwrap();
        assert_eq!(r.objective_value, 0.0);
        assert_eq!(r.status, OrToolsStatus::Optimal);
        assert_eq!(r.solve_time_ms, 0);
    }

    #[test]
    fn empty_problem_cp_sat_returns_zero_optimal() {
        let p = Problem { vehicles: vec![], orders: vec![] };
        let r = solve_cp_sat(&p, Objective::Distance, Duration::from_secs(1), 1).unwrap();
        assert_eq!(r.objective_value, 0.0);
        assert_eq!(r.status, OrToolsStatus::Optimal);
    }

    #[test]
    fn empty_objective_routing_rejected() {
        let p = one_vehicle_one_order();
        let err = solve_routing(&p, Objective::Empty, Duration::from_secs(1), 1).unwrap_err();
        assert!(matches!(err, OrToolsError::UnsupportedObjective(Objective::Empty)));
    }

    #[test]
    fn empty_objective_cp_sat_rejected() {
        let p = one_vehicle_one_order();
        let err = solve_cp_sat(&p, Objective::Empty, Duration::from_secs(1), 1).unwrap_err();
        assert!(matches!(err, OrToolsError::UnsupportedObjective(Objective::Empty)));
    }
}
