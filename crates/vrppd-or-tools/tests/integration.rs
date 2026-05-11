//! Integration tests for vrppd-or-tools. Gated behind `VRPPD_TEST_ORTOOLS=1`
//! since they spawn the Python subprocess (requires `pip install ortools`).
//!
//! Run with: `VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration`.

use std::time::Duration;
use vrppd_core::{Location, Objective, Order, Problem, Vehicle};
use vrppd_or_tools::{solve_cp_sat, solve_routing, OrToolsError, OrToolsStatus};

fn skip_unless_enabled() -> bool {
    if std::env::var("VRPPD_TEST_ORTOOLS").is_err() {
        eprintln!("skipping (set VRPPD_TEST_ORTOOLS=1 to run)");
        return true;
    }
    false
}

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
            start_location: loc(54.6872, 25.2797),
            price_km: 1.0,
        }],
        orders: vec![Order {
            id: 1,
            pickup_location: loc(54.6872, 25.2797),
            delivery_location: loc(54.7000, 25.3000),
            load_factor: 1.0,
        }],
    }
}

#[test]
fn plumbing_surfaces_solver_internal_for_placeholder() {
    if skip_unless_enabled() {
        return;
    }
    let p = one_vehicle_one_order();
    // The Python placeholder returns error_kind="solver_internal", which the
    // Rust side maps to OrToolsError::SolverInternal.
    let err = solve_routing(&p, Objective::Distance, Duration::from_secs(10), 1).unwrap_err();
    match err {
        OrToolsError::SolverInternal(msg) => {
            assert!(msg.contains("not yet implemented"), "unexpected msg: {msg}");
        }
        other => panic!("expected SolverInternal, got {other:?}"),
    }
}

#[test]
fn cp_sat_n1_matches_bf() {
    if skip_unless_enabled() {
        return;
    }
    let p = one_vehicle_one_order();
    let bf = vrppd_brute_force::solve(&p);
    let bf_optimum = bf.best_distance_solution.total_distance;

    let r = solve_cp_sat(&p, Objective::Distance, Duration::from_secs(30), 2).unwrap();
    assert_eq!(r.status, OrToolsStatus::Optimal);
    assert!(
        (r.objective_value - bf_optimum).abs() < 1e-2,
        "CP-SAT {} vs BF {}",
        r.objective_value,
        bf_optimum
    );
}

#[test]
fn cp_sat_n3_matches_bf() {
    if skip_unless_enabled() {
        return;
    }
    use std::path::PathBuf;

    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("../vrppd-bounds/tests/fixtures/two_vehicles_three_orders.json");
    let raw = std::fs::read_to_string(&path).unwrap();
    let problem: Problem = serde_json::from_str(&raw).unwrap();

    let bf = vrppd_brute_force::solve(&problem);
    let bf_optimum = bf.best_distance_solution.total_distance;

    let r = solve_cp_sat(&problem, Objective::Distance, Duration::from_secs(60), 2).unwrap();
    assert_eq!(
        r.status,
        OrToolsStatus::Optimal,
        "CP-SAT did not prove optimum in 60s on the 2v3o fixture"
    );
    assert!(
        (r.objective_value - bf_optimum).abs() < 1e-3,
        "CP-SAT {} vs BF {}",
        r.objective_value,
        bf_optimum
    );
}

#[test]
fn cp_sat_status_timeout() {
    if skip_unless_enabled() {
        return;
    }
    use std::path::PathBuf;

    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("../vrppd-bounds/tests/fixtures/two_vehicles_three_orders.json");
    let raw = std::fs::read_to_string(&path).unwrap();
    let problem: Problem = serde_json::from_str(&raw).unwrap();

    // 1 ms is well below CP-SAT's startup overhead → status must be
    // FEASIBLE (incumbent found by primal heuristic) or TIMED_OUT.
    let r = solve_cp_sat(&problem, Objective::Distance, Duration::from_millis(1), 1).unwrap();
    assert!(
        matches!(r.status, OrToolsStatus::Feasible | OrToolsStatus::TimedOut),
        "expected Feasible or TimedOut, got {:?}",
        r.status
    );
}
