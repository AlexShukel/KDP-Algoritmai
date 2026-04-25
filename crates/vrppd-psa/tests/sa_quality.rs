//! End-to-end SA quality tests, anchored against the exact brute-force solver.
//!
//! These tests intentionally use small fixtures (N ≤ 3) where the optimum is
//! computable in milliseconds, so the SA's stochastic output can be validated
//! within a tight numerical bound across multiple seeds.

use std::path::PathBuf;

use vrppd_core::{Objective, Problem};
use vrppd_psa::{default_config_for, solve_seeded};

fn load_fixture(name: &str) -> Problem {
  let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  path.push("tests/fixtures");
  path.push(name);
  let raw = std::fs::read_to_string(&path).unwrap();
  serde_json::from_str(&raw).unwrap()
}

#[test]
fn sa_matches_brute_force_on_single_order() {
  // With one vehicle and one order, the only valid route is start → pickup →
  // delivery, so SA must produce the exact same totals as the exact solver
  // regardless of seed or temperature schedule.
  let problem = load_fixture("single_vehicle_single_order.json");
  let bf = vrppd_brute_force::solve(&problem);
  let bf_dist = bf.best_distance_solution.total_distance;

  for seed in [1_u64, 7, 42, 123, 9999] {
    let solved = solve_seeded(
      &problem,
      Objective::Distance,
      default_config_for(Objective::Distance),
      seed,
    );
    assert!(
      (solved.solution.total_distance - bf_dist).abs() < 1e-9,
      "seed {seed}: SA total_distance {} != BF {}",
      solved.solution.total_distance,
      bf_dist
    );
  }
}

#[test]
fn sa_finds_brute_force_optimum_on_three_orders() {
  // N=3 keeps brute force fast and the search space small enough that SA with
  // its default budget should reach the optimum on most seeds. The bound here
  // is intentionally loose (5% RPD) to absorb stochastic variance — the goal
  // is to detect outright algorithmic regressions, not to gauge tuning.
  let problem = load_fixture("two_vehicles_three_orders.json");
  let bf = vrppd_brute_force::solve(&problem);

  for target in [Objective::Distance, Objective::Empty, Objective::Price] {
    let bf_energy = target.energy(match target {
      Objective::Distance => &bf.best_distance_solution,
      Objective::Empty => &bf.best_empty_solution,
      Objective::Price => &bf.best_price_solution,
    });

    let mut best_rpd = f64::INFINITY;
    for seed in 0..10_u64 {
      let solved = solve_seeded(&problem, target, default_config_for(target), seed);
      let sa_energy = target.energy(&solved.solution);
      let rpd = (sa_energy - bf_energy) / bf_energy.max(1e-9);
      best_rpd = best_rpd.min(rpd);
    }
    assert!(
      best_rpd < 0.05,
      "objective {:?}: best RPD across 10 seeds was {:.4}, expected < 5%",
      target,
      best_rpd
    );
  }
}

#[test]
fn sa_history_is_monotone_improving() {
  // The convergence trace records each accepted improvement, so its energy
  // values must be monotonically non-increasing under the active objective.
  let problem = load_fixture("two_vehicles_three_orders.json");
  let solved = solve_seeded(
    &problem,
    Objective::Distance,
    default_config_for(Objective::Distance),
    2026,
  );

  let mut prev = f64::INFINITY;
  for point in &solved.history {
    let e = point.solution.total_distance;
    assert!(
      e <= prev + 1e-9,
      "convergence trace not monotone: {e} > {prev} at iter {}",
      point.iteration
    );
    prev = e;
  }
}
