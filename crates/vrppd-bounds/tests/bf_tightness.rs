//! Validate that direct-sum lower bounds are sound (`LB ≤ optimum`) and
//! report tightness (`LB / optimum`) on small fixtures where the
//! brute-force solver gives the optimum.
//!
//! Soundness is the *correctness* property — a bound below 0% would mean
//! the bound is broken. Tightness is for the thesis: how close to the
//! optimum is the trivial bound? We expect EMPTY's bound to be useless
//! (always 0), DISTANCE's bound to be tight on the loaded portion (so
//! looseness comes purely from start-to-pickup deadhead), PRICE's bound
//! to follow DISTANCE scaled by `min(price_km)` so it's looser when the
//! fleet is heterogeneous.

use std::path::PathBuf;

use vrppd_bounds::lower_bound_direct;
use vrppd_core::{Objective, Problem};

fn load_fixture(name: &str) -> Problem {
  let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  path.push("tests/fixtures");
  path.push(name);
  let raw = std::fs::read_to_string(&path).unwrap();
  serde_json::from_str(&raw).unwrap()
}

fn report(label: &str, lb: f64, opt: f64) -> f64 {
  let ratio = if opt.abs() < 1e-12 {
    f64::NAN
  } else {
    lb / opt
  };
  // Print intentionally — `cargo test -- --nocapture` shows tightness.
  println!("{label:<32}  LB={lb:>10.3}  opt={opt:>10.3}  LB/opt={ratio:>6.3}");
  ratio
}

#[test]
fn direct_bound_is_sound_on_n1_fixture() {
  let problem = load_fixture("single_vehicle_single_order.json");
  let bf = vrppd_brute_force::solve(&problem);
  let lb = lower_bound_direct(&problem);

  report("N=1 EMPTY", lb.empty, bf.best_empty_solution.empty_distance);
  report(
    "N=1 DISTANCE",
    lb.distance,
    bf.best_distance_solution.total_distance,
  );
  report("N=1 PRICE", lb.price, bf.best_price_solution.total_price);

  // Soundness: LB ≤ optimum, with a small numeric tolerance.
  assert!(lb.empty <= bf.best_empty_solution.empty_distance + 1e-9);
  assert!(lb.distance <= bf.best_distance_solution.total_distance + 1e-9);
  assert!(lb.price <= bf.best_price_solution.total_price + 1e-9);
}

#[test]
fn direct_bound_is_sound_on_n3_fixture() {
  let problem = load_fixture("two_vehicles_three_orders.json");
  let bf = vrppd_brute_force::solve(&problem);
  let lb = lower_bound_direct(&problem);

  report("N=3 EMPTY", lb.empty, bf.best_empty_solution.empty_distance);
  report(
    "N=3 DISTANCE",
    lb.distance,
    bf.best_distance_solution.total_distance,
  );
  report("N=3 PRICE", lb.price, bf.best_price_solution.total_price);

  assert!(lb.empty <= bf.best_empty_solution.empty_distance + 1e-9);
  assert!(lb.distance <= bf.best_distance_solution.total_distance + 1e-9);
  assert!(lb.price <= bf.best_price_solution.total_price + 1e-9);
}

#[test]
fn distance_bound_loose_amount_equals_deadhead() {
  // The DISTANCE optimum decomposes as `loaded + empty`, and our
  // direct-sum bound captures exactly the loaded portion. So
  // `optimum − LB == optimum's empty distance`.
  let problem = load_fixture("two_vehicles_three_orders.json");
  let bf = vrppd_brute_force::solve(&problem);
  let lb = lower_bound_direct(&problem);

  let gap = bf.best_distance_solution.total_distance - lb.distance;
  let observed_empty = bf.best_distance_solution.empty_distance;
  assert!(
    (gap - observed_empty).abs() < 1e-6,
    "gap {gap:.6} != optimum empty {observed_empty:.6}"
  );
}

#[test]
fn empty_bound_is_zero_and_sound() {
  // EMPTY's trivial bound is always zero. The optimum is non-negative
  // (no negative empty distance is physical), so soundness is automatic.
  // We verify it on both fixtures to keep the suite honest.
  for name in [
    "single_vehicle_single_order.json",
    "two_vehicles_three_orders.json",
  ] {
    let problem = load_fixture(name);
    let lb = lower_bound_direct(&problem);
    assert_eq!(lb.empty, 0.0);
    let bf = vrppd_brute_force::solve(&problem);
    let opt_empty = bf.best_empty_solution.empty_distance;
    assert!(
      opt_empty >= -1e-9,
      "EMPTY optimum negative for {name}? {opt_empty}"
    );
    assert!(
      lb.empty <= opt_empty + 1e-9,
      "EMPTY bound 0 must be ≤ optimum {opt_empty} for {name}"
    );
    let _ = Objective::Empty; // silence unused-import warning when both arms compile-out
  }
}
