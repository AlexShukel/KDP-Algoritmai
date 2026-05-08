//! Empirical bound-validation sweep — PLAN.md §3.4.
//!
//! For every problem instance under a configurable directory whose order
//! count is `≤ MAX_N`, runs the brute-force optimum, the LP-relaxation
//! lower bound, and the exact MILP solver, and writes one CSV row per
//! `(instance, objective)`. Three thesis numbers fall out of the output:
//!
//! 1. **Soundness:** does `LP_LB ≤ BF_opt` hold on every row?
//! 2. **LP tightness:** the distribution of `LP_LB / BF_opt`.
//! 3. **MILP/BF agreement:** does `MILP_opt == BF_opt` (within tolerance)?
//!
//! The sweep is deterministic — no RNG, no time budget on BF or LP, only
//! a per-instance MILP timeout (default 60 s here, well under PLAN's
//! 30-min ceiling — bound validation runs on small instances where MILP
//! finishes in well under a second).
//!
//! Usage:
//!
//! ```text
//! cargo run -p vrppd-validation --bin bound-sweep --release -- \
//!   [--problems DIR]            # default ./problems
//!   [--max-n N]                 # default 7 (covers entire small bank)
//!   [--milp-timeout-secs SECS]  # default 60
//!   [--output PATH]             # default ./results/bound_sweep.csv
//! ```
//!
//! Tolerances match the unit tests: 1e-3 km / EUR for primal-vs-primal
//! agreement; 1e-6 slack on soundness inequalities.

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use vrppd_bounds::lower_bound_lp;
use vrppd_core::{Objective, Problem};
use vrppd_milp::{solve_milp, MilpStatus};

const SOUNDNESS_SLACK: f64 = 1e-6;
const PRIMAL_AGREEMENT_TOL: f64 = 1e-3;

#[derive(Clone, Debug)]
struct Args {
  problems_dir: PathBuf,
  max_n: usize,
  milp_timeout: Duration,
  output: PathBuf,
}

fn parse_args() -> Args {
  let mut args = Args {
    problems_dir: PathBuf::from("problems"),
    max_n: 7,
    milp_timeout: Duration::from_secs(60),
    output: PathBuf::from("results/bound_sweep.csv"),
  };
  let mut it = std::env::args().skip(1);
  while let Some(arg) = it.next() {
    match arg.as_str() {
      "--problems" => args.problems_dir = it.next().expect("--problems needs a value").into(),
      "--max-n" => {
        args.max_n = it
          .next()
          .expect("--max-n needs a value")
          .parse()
          .expect("--max-n must be an integer");
      }
      "--milp-timeout-secs" => {
        let secs: u64 = it
          .next()
          .expect("--milp-timeout-secs needs a value")
          .parse()
          .expect("--milp-timeout-secs must be an integer");
        args.milp_timeout = Duration::from_secs(secs);
      }
      "--output" => args.output = it.next().expect("--output needs a value").into(),
      other => panic!("unknown argument {other}"),
    }
  }
  args
}

fn main() {
  let args = parse_args();
  println!(
    "bound-sweep: problems={:?} max_n={} milp_timeout={:?} output={:?}",
    args.problems_dir, args.max_n, args.milp_timeout, args.output
  );

  let mut instances: Vec<PathBuf> = Vec::new();
  collect_jsons(&args.problems_dir, &mut instances);
  instances.sort();
  println!("found {} instance files", instances.len());

  if let Some(parent) = args.output.parent() {
    fs::create_dir_all(parent).expect("create output dir");
  }
  let out = File::create(&args.output).expect("open output");
  let mut w = BufWriter::new(out);
  writeln!(
    w,
    "instance,n,v,objective,bf_optimum,lp_lb,lp_ratio,milp_value,milp_status,milp_time_ms,sound,milp_matches_bf"
  )
  .unwrap();

  // Per-objective aggregates so the run prints a thesis-ready summary at
  // the end without needing to re-parse the CSV. Keyed by objective name
  // so the output order is stable across runs.
  let mut agg: BTreeMap<&'static str, Aggregate> = BTreeMap::new();
  let started_all = Instant::now();
  let mut row_count = 0usize;

  for path in &instances {
    let raw = match fs::read_to_string(path) {
      Ok(s) => s,
      Err(e) => {
        eprintln!("skip {}: {e}", path.display());
        continue;
      }
    };
    let problem: Problem = match serde_json::from_str(&raw) {
      Ok(p) => p,
      Err(e) => {
        eprintln!("skip {}: parse error {e}", path.display());
        continue;
      }
    };
    if problem.orders.len() > args.max_n {
      continue;
    }
    let n = problem.orders.len();
    let v = problem.vehicles.len();

    let bf = vrppd_brute_force::solve(&problem);
    // Brute-force returns its sentinel "no feasible solution" object on
    // pathological inputs; skip those so the soundness check doesn't
    // get confused by zeros.
    if bf.best_distance_solution.total_distance == 0.0 && n > 0 {
      eprintln!(
        "skip {} (BF returned trivial 0 — likely no feasible assignment)",
        path.display()
      );
      continue;
    }

    for &(obj_name, obj, bf_opt) in &[
      (
        "DISTANCE",
        Objective::Distance,
        bf.best_distance_solution.total_distance,
      ),
      (
        "PRICE",
        Objective::Price,
        bf.best_price_solution.total_price,
      ),
    ] {
      let lp_lb = match lower_bound_lp(&problem, obj) {
        Ok(v) => v,
        Err(e) => {
          eprintln!("LP failed on {} {obj_name}: {e}", path.display());
          continue;
        }
      };
      let milp = match solve_milp(&problem, obj, args.milp_timeout) {
        Ok(r) => r,
        Err(e) => {
          eprintln!("MILP failed on {} {obj_name}: {e}", path.display());
          continue;
        }
      };

      let sound = lp_lb <= bf_opt + SOUNDNESS_SLACK;
      let lp_ratio = if bf_opt.abs() > 1e-12 {
        lp_lb / bf_opt
      } else {
        f64::NAN
      };
      let milp_matches = (milp.objective_value - bf_opt).abs() < PRIMAL_AGREEMENT_TOL;
      let milp_status = match milp.status {
        MilpStatus::Optimal => "OPTIMAL",
        MilpStatus::TimedOut => "TIMEDOUT",
      };

      let entry = agg.entry(obj_name).or_default();
      entry.rows += 1;
      if sound {
        entry.sound += 1;
      }
      if milp_matches {
        entry.milp_match += 1;
      }
      if !lp_ratio.is_nan() {
        entry.lp_ratio_sum += lp_ratio;
        entry.lp_ratio_min = entry.lp_ratio_min.min(lp_ratio);
        entry.lp_ratio_max = entry.lp_ratio_max.max(lp_ratio);
        entry.lp_ratio_count += 1;
      }
      if matches!(milp.status, MilpStatus::TimedOut) {
        entry.milp_timeouts += 1;
      }

      writeln!(
        w,
        "{},{n},{v},{obj_name},{bf_opt:.6},{lp_lb:.6},{lp_ratio:.6},{:.6},{milp_status},{},{},{}",
        path.display().to_string().replace(',', ";"),
        milp.objective_value,
        milp.solve_time_ms,
        sound,
        milp_matches,
      )
      .unwrap();
      row_count += 1;
    }
  }
  w.flush().unwrap();
  let elapsed = started_all.elapsed();
  println!(
    "wrote {row_count} rows to {} in {:.2?}",
    args.output.display(),
    elapsed
  );
  println!();
  println!("=== summary ===");
  for (obj_name, a) in &agg {
    let mean_ratio = if a.lp_ratio_count > 0 {
      a.lp_ratio_sum / a.lp_ratio_count as f64
    } else {
      f64::NAN
    };
    println!(
      "{obj_name:<10}  rows={:<5}  sound={}/{}  milp_match={}/{}  milp_timeouts={}  \
       lp_ratio: mean={mean_ratio:>6.4} min={:>6.4} max={:>6.4}",
      a.rows,
      a.sound,
      a.rows,
      a.milp_match,
      a.rows,
      a.milp_timeouts,
      a.lp_ratio_min,
      a.lp_ratio_max,
    );
  }
}

#[derive(Debug)]
struct Aggregate {
  rows: usize,
  sound: usize,
  milp_match: usize,
  milp_timeouts: usize,
  lp_ratio_sum: f64,
  lp_ratio_min: f64,
  lp_ratio_max: f64,
  lp_ratio_count: usize,
}

impl Default for Aggregate {
  fn default() -> Self {
    Self {
      rows: 0,
      sound: 0,
      milp_match: 0,
      milp_timeouts: 0,
      lp_ratio_sum: 0.0,
      lp_ratio_min: f64::INFINITY,
      lp_ratio_max: f64::NEG_INFINITY,
      lp_ratio_count: 0,
    }
  }
}

fn collect_jsons(dir: &Path, out: &mut Vec<PathBuf>) {
  let entries = match fs::read_dir(dir) {
    Ok(e) => e,
    Err(_) => return,
  };
  for entry in entries.flatten() {
    let p = entry.path();
    if p.is_dir() {
      collect_jsons(&p, out);
    } else if p.extension().and_then(|s| s.to_str()) == Some("json") {
      out.push(p);
    }
  }
}
