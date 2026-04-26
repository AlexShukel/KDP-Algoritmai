//! Tightness check: the MILP optimum must coincide with the brute-force
//! optimum on the small fixtures, for every supported objective.
//!
//! This is the strongest correctness signal we can get for the adapted
//! MILP — both solvers explore the same feasible region and minimise the
//! same expression, so disagreement on a small instance means one of the
//! formulations is wrong. EMPTY is intentionally excluded; see the
//! module-level doc comment in `vrppd_milp` for why the MILP and BF
//! definitions don't coincide.

use std::path::PathBuf;
use std::time::Duration;

use vrppd_core::{Objective, Problem};
use vrppd_milp::{solve_milp, MilpStatus};

fn load_fixture(name: &str) -> Problem {
  let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  // Fixtures live alongside the bounds crate's tests — the same instances
  // are the ground truth for every solver.
  path.push("..");
  path.push("vrppd-bounds");
  path.push("tests/fixtures");
  path.push(name);
  let raw = std::fs::read_to_string(&path).unwrap();
  serde_json::from_str(&raw).unwrap()
}

fn assert_matches_bf(
  fixture: &str,
  objective: Objective,
  bf_optimum: f64,
  tolerance: f64,
) {
  let problem = load_fixture(fixture);
  let result = solve_milp(&problem, objective, Duration::from_secs(60))
    .unwrap_or_else(|e| panic!("MILP failed on {fixture}/{objective:?}: {e}"));
  assert_eq!(
    result.status,
    MilpStatus::Optimal,
    "MILP did not reach optimal on {fixture}/{objective:?} within 60 s"
  );
  let diff = (result.objective_value - bf_optimum).abs();
  assert!(
    diff < tolerance,
    "MILP optimum {} disagrees with BF optimum {} on {fixture}/{objective:?} \
     (|diff| = {diff}, tolerance = {tolerance})",
    result.objective_value,
    bf_optimum,
  );
}

#[test]
fn milp_matches_bf_on_n1_distance() {
  let problem = load_fixture("single_vehicle_single_order.json");
  let bf = vrppd_brute_force::solve(&problem);
  assert_matches_bf(
    "single_vehicle_single_order.json",
    Objective::Distance,
    bf.best_distance_solution.total_distance,
    1e-3,
  );
}

#[test]
fn milp_matches_bf_on_n1_price() {
  let problem = load_fixture("single_vehicle_single_order.json");
  let bf = vrppd_brute_force::solve(&problem);
  assert_matches_bf(
    "single_vehicle_single_order.json",
    Objective::Price,
    bf.best_price_solution.total_price,
    1e-3,
  );
}

#[test]
fn milp_matches_bf_on_n3_distance() {
  let problem = load_fixture("two_vehicles_three_orders.json");
  let bf = vrppd_brute_force::solve(&problem);
  assert_matches_bf(
    "two_vehicles_three_orders.json",
    Objective::Distance,
    bf.best_distance_solution.total_distance,
    1e-3,
  );
}

#[test]
fn milp_matches_bf_on_n3_price() {
  let problem = load_fixture("two_vehicles_three_orders.json");
  let bf = vrppd_brute_force::solve(&problem);
  assert_matches_bf(
    "two_vehicles_three_orders.json",
    Objective::Price,
    bf.best_price_solution.total_price,
    1e-3,
  );
}
