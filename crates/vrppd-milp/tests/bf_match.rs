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

use vrppd_core::{Objective, Problem};

/// Load `problems/<V>_<N>/0_<latest_ts>.json` from the repo root. Picks the
/// sample-0 file with the highest timestamp, matching the latest invocation
/// of `pnpm generate:problems:small`.
fn load_grid_problem(v: usize, n: usize) -> Problem {
  let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  dir.push("../..");
  dir.push("problems");
  dir.push(format!("{v}_{n}"));

  let mut entries: Vec<(u64, std::fs::DirEntry)> = std::fs::read_dir(&dir)
    .unwrap_or_else(|e| panic!("read_dir {dir:?}: {e}"))
    .filter_map(|e| e.ok())
    .filter_map(|e| {
      let name = e.file_name().into_string().ok()?;
      let stem = name.strip_suffix(".json")?;
      let (idx, ts) = stem.split_once('_')?;
      if idx != "0" {
        return None;
      }
      let ts: u64 = ts.parse().ok()?;
      Some((ts, e))
    })
    .collect();

  entries.sort_by_key(|(ts, _)| *ts);
  let (_, entry) = entries
    .last()
    .unwrap_or_else(|| panic!("no sample-0 problem under {dir:?}"));
  let raw = std::fs::read_to_string(entry.path()).unwrap();
  serde_json::from_str(&raw).unwrap()
}

fn check_cell(v: usize, n: usize) {
  let problem = load_grid_problem(v, n);
  let bf = vrppd_brute_force::solve(&problem);

  for (target, bf_optimum) in [
    (Objective::Distance, bf.best_distance_solution.total_distance),
    (Objective::Price, bf.best_price_solution.total_price),
  ] {
    let cold = vrppd_milp::solve_milp(&problem, target, std::time::Duration::from_secs(600), 1)
      .unwrap_or_else(|e| panic!("MILP cold v={v} n={n} target={target:?}: {e}"));
    assert_eq!(
      cold.status,
      vrppd_milp::MilpStatus::Optimal,
      "cold MILP timed out on v={v} n={n} target={target:?} (raise the 600s budget or mark this cell #[ignore])"
    );
    assert!(
      (cold.objective_value - bf_optimum).abs() < 1e-3,
      "cold MILP {} != BF {} on v={v} n={n} target={target:?}",
      cold.objective_value,
      bf_optimum
    );
  }
}

fn check_cell_warm(v: usize, n: usize) {
  use vrppd_psa::{default_config_for, solve_pipeline_seeded};

  let problem = load_grid_problem(v, n);
  let bf = vrppd_brute_force::solve(&problem);

  for (target, bf_optimum) in [
    (Objective::Distance, bf.best_distance_solution.total_distance),
    (Objective::Price, bf.best_price_solution.total_price),
  ] {
    let psa = solve_pipeline_seeded(&problem, target, default_config_for(target), 1);
    let warm = vrppd_milp::solve_milp_with_warm_start(
      &problem,
      target,
      std::time::Duration::from_secs(600),
      1,
      &psa.solution,
    )
    .unwrap_or_else(|e| panic!("MILP warm v={v} n={n} target={target:?}: {e}"));
    assert_eq!(
      warm.status,
      vrppd_milp::MilpStatus::Optimal,
      "warm MILP timed out on v={v} n={n} target={target:?}"
    );
    assert!(
      (warm.objective_value - bf_optimum).abs() < 1e-3,
      "warm MILP {} != BF {} on v={v} n={n} target={target:?}",
      warm.objective_value,
      bf_optimum
    );
  }
}

macro_rules! grid_cell {
  (run, $v:literal, $n:literal) => {
    paste::paste! {
      #[test]
      fn [<milp_matches_bf_v $v _n $n _cold>]() {
        check_cell($v, $n);
      }
      #[test]
      fn [<milp_matches_bf_v $v _n $n _warm>]() {
        check_cell_warm($v, $n);
      }
    }
  };
  (ignore, $v:literal, $n:literal) => {
    paste::paste! {
      #[test]
      #[ignore]
      fn [<milp_matches_bf_v $v _n $n _cold>]() {
        check_cell($v, $n);
      }
      #[test]
      #[ignore]
      fn [<milp_matches_bf_v $v _n $n _warm>]() {
        check_cell_warm($v, $n);
      }
    }
  };
}

grid_cell!(run, 1, 1);
grid_cell!(run, 1, 2);
grid_cell!(run, 1, 3);
grid_cell!(run, 1, 4);
grid_cell!(run, 1, 5);
grid_cell!(run, 1, 6);
grid_cell!(run, 1, 7);

grid_cell!(run, 2, 1);
grid_cell!(run, 2, 2);
grid_cell!(run, 2, 3);
grid_cell!(run, 2, 4);
grid_cell!(run, 2, 5);
grid_cell!(run, 2, 6);
grid_cell!(run, 2, 7);

grid_cell!(run, 3, 1);
grid_cell!(run, 3, 2);
grid_cell!(run, 3, 3);
grid_cell!(run, 3, 4);
grid_cell!(run, 3, 5);
grid_cell!(run, 3, 6);
grid_cell!(run, 3, 7);

grid_cell!(run, 4, 1);
grid_cell!(run, 4, 2);
grid_cell!(run, 4, 3);
grid_cell!(run, 4, 4);
grid_cell!(run, 4, 5);
grid_cell!(run, 4, 6);
grid_cell!(ignore, 4, 7); // 4*7=28 > 25

grid_cell!(run, 5, 1);
grid_cell!(run, 5, 2);
grid_cell!(run, 5, 3);
grid_cell!(run, 5, 4);
grid_cell!(run, 5, 5);
grid_cell!(ignore, 5, 6); // 30
grid_cell!(ignore, 5, 7); // 35

grid_cell!(run, 6, 1);
grid_cell!(run, 6, 2);
grid_cell!(run, 6, 3);
grid_cell!(run, 6, 4);
grid_cell!(ignore, 6, 5); // 30
grid_cell!(ignore, 6, 6); // 36
grid_cell!(ignore, 6, 7); // 42

grid_cell!(run, 7, 1);
grid_cell!(run, 7, 2);
grid_cell!(run, 7, 3);
grid_cell!(ignore, 7, 4); // 28
grid_cell!(ignore, 7, 5); // 35
grid_cell!(ignore, 7, 6); // 42
grid_cell!(ignore, 7, 7); // 49
