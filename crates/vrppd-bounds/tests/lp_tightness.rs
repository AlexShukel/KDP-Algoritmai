//! LP-relaxation soundness + tightness against brute-force optima.
//!
//! Soundness: `LB_LP ≤ optimum` for every objective on every fixture
//! where the brute-force optimum is computable. Tightness: the LP bound
//! must dominate the trivial direct-sum bound on instances where the
//! direct-sum bound has nontrivial deadhead to absorb. We don't expect
//! the LP to match the optimum — the integrality gap is real — but for
//! the small fixtures used here the LP/optimum ratio reported by the
//! tests should sit comfortably above the direct-sum ratio.

use std::path::PathBuf;

use vrppd_bounds::{lower_bound_direct, lower_bound_lp};
use vrppd_core::{Objective, Problem};

fn load_fixture(name: &str) -> Problem {
  let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  path.push("tests/fixtures");
  path.push(name);
  let raw = std::fs::read_to_string(&path).unwrap();
  serde_json::from_str(&raw).unwrap()
}

fn report(label: &str, lb_lp: f64, lb_direct: f64, opt: f64) {
  let lp_ratio = if opt.abs() < 1e-12 {
    f64::NAN
  } else {
    lb_lp / opt
  };
  let dir_ratio = if opt.abs() < 1e-12 {
    f64::NAN
  } else {
    lb_direct / opt
  };
  println!(
    "{label:<32}  LP={lb_lp:>10.3}  direct={lb_direct:>10.3}  opt={opt:>10.3}  \
     LP/opt={lp_ratio:>6.3}  direct/opt={dir_ratio:>6.3}"
  );
}

#[test]
fn lp_bound_is_sound_on_n1_fixture() {
  // EMPTY is intentionally excluded — see lower_bound_lp's doc comment for
  // why the LP-relaxation can't bound the implementation's load-aware
  // empty distance with the current MILP formulation.
  let problem = load_fixture("single_vehicle_single_order.json");
  let bf = vrppd_brute_force::solve(&problem);
  let direct = lower_bound_direct(&problem);

  for (label, target, opt) in [
    (
      "N=1 DISTANCE",
      Objective::Distance,
      bf.best_distance_solution.total_distance,
    ),
    (
      "N=1 PRICE",
      Objective::Price,
      bf.best_price_solution.total_price,
    ),
  ] {
    let lb = lower_bound_lp(&problem, target).unwrap();
    report(label, lb, direct.for_objective(target), opt);

    assert!(lb <= opt + 1e-6, "{label}: LP {lb} > opt {opt}");
    assert!(
      lb >= direct.for_objective(target) - 1e-6,
      "{label}: LP {lb} < direct {}",
      direct.for_objective(target)
    );
  }
}

#[test]
fn lp_bound_is_sound_on_n3_fixture() {
  let problem = load_fixture("two_vehicles_three_orders.json");
  let bf = vrppd_brute_force::solve(&problem);
  let direct = lower_bound_direct(&problem);

  for (label, target, opt) in [
    (
      "N=3 DISTANCE",
      Objective::Distance,
      bf.best_distance_solution.total_distance,
    ),
    (
      "N=3 PRICE",
      Objective::Price,
      bf.best_price_solution.total_price,
    ),
  ] {
    let lb = lower_bound_lp(&problem, target).unwrap();
    report(label, lb, direct.for_objective(target), opt);

    assert!(lb <= opt + 1e-6, "{label}: LP {lb} > opt {opt}");
    assert!(
      lb >= direct.for_objective(target) - 1e-6,
      "{label}: LP {lb} < direct {}",
      direct.for_objective(target)
    );
  }
}

#[test]
fn lp_empty_returns_trivial_zero() {
  // EMPTY is documented as unsupported (returns 0). Verified to keep the
  // contract honest: callers should be able to rely on this.
  for fixture in [
    "single_vehicle_single_order.json",
    "two_vehicles_three_orders.json",
  ] {
    let problem = load_fixture(fixture);
    let lb = lower_bound_lp(&problem, Objective::Empty).unwrap();
    assert_eq!(
      lb, 0.0,
      "EMPTY LP bound for {fixture} should be 0, was {lb}"
    );
  }
}
