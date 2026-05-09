//! Compares sequential (threads=1) vs parallel (threads=num_cpus) CEA on
//! three 10v×20o problems across all three objectives, 5 reps each.
//! Writes a markdown report to results/cea-parallel-report.md.

use std::fs;
use std::time::Instant;

use vrppd_cea::{solve_cea_seeded, CeaConfig};
use vrppd_core::{Objective, Problem};

const PROBLEMS: &[&str] = &[
  "problems/10_20/0_1778169862263.json",
  "problems/10_20/18_1778169862263.json",
  "problems/10_20/8_1778169862263.json",
];
const OBJECTIVES: &[Objective] = &[Objective::Distance, Objective::Price, Objective::Empty];
const REPS: u64 = 5;
const WALL_CAP_MS: u64 = 30_000;

fn obj_label(o: Objective) -> &'static str {
  match o {
    Objective::Distance => "DISTANCE",
    Objective::Price => "PRICE",
    Objective::Empty => "EMPTY",
  }
}

fn obj_value(sol: &vrppd_core::ProblemSolution, o: Objective) -> f64 {
  match o {
    Objective::Distance => sol.total_distance,
    Objective::Price => sol.total_price,
    Objective::Empty => sol.empty_distance,
  }
}

struct RunResult {
  time_ms: f64,
  generations: u64,
  value: f64,
}

fn run_cea(problem: &Problem, obj: Objective, threads: usize, seed: u64) -> RunResult {
  let config = CeaConfig {
    threads,
    wall_time_cap_ms: Some(WALL_CAP_MS),
    ..CeaConfig::default()
  };
  let t0 = Instant::now();
  let solved = solve_cea_seeded(problem, obj, config, seed);
  RunResult {
    time_ms: t0.elapsed().as_secs_f64() * 1_000.0,
    generations: solved.generations,
    value: obj_value(&solved.solution, obj),
  }
}

fn mean(v: &[f64]) -> f64 {
  v.iter().sum::<f64>() / v.len() as f64
}

fn main() {
  let num_threads = std::thread::available_parallelism()
    .map(|n| n.get())
    .unwrap_or(4);

  println!("Running comparison: sequential (threads=1) vs parallel (threads={num_threads})");
  println!("Problems: {}", PROBLEMS.len());
  println!("Objectives: {}", OBJECTIVES.len());
  println!("Reps: {REPS}, wall cap: {WALL_CAP_MS}ms each\n");

  #[derive(Default)]
  struct Cell {
    seq_times: Vec<f64>,
    par_times: Vec<f64>,
    seq_gens: Vec<f64>,
    par_gens: Vec<f64>,
    seq_vals: Vec<f64>,
    par_vals: Vec<f64>,
  }

  // results[problem_idx][obj_idx]
  let mut results: Vec<Vec<Cell>> = PROBLEMS
    .iter()
    .map(|_| OBJECTIVES.iter().map(|_| Cell::default()).collect())
    .collect();

  for (pi, path) in PROBLEMS.iter().enumerate() {
    let raw = fs::read_to_string(path).unwrap_or_else(|e| panic!("Cannot read {path}: {e}"));
    let problem: Problem = serde_json::from_str(&raw).unwrap();
    for (oi, &obj) in OBJECTIVES.iter().enumerate() {
      for rep in 0..REPS {
        let seed = (pi as u64) * 1_000 + (oi as u64) * 100 + rep;
        print!("  {path} {} seq rep {rep}...", obj_label(obj));
        let s = run_cea(&problem, obj, 1, seed);
        println!(
          " {:.0}ms  {:.4}  {} gens",
          s.time_ms, s.value, s.generations
        );
        results[pi][oi].seq_times.push(s.time_ms);
        results[pi][oi].seq_gens.push(s.generations as f64);
        results[pi][oi].seq_vals.push(s.value);

        print!("  {path} {} par rep {rep}...", obj_label(obj));
        let p = run_cea(&problem, obj, num_threads, seed);
        println!(
          " {:.0}ms  {:.4}  {} gens",
          p.time_ms, p.value, p.generations
        );
        results[pi][oi].par_times.push(p.time_ms);
        results[pi][oi].par_gens.push(p.generations as f64);
        results[pi][oi].par_vals.push(p.value);
      }
    }
  }

  // --- build report ---
  let mut md = String::new();
  md.push_str("# CEA Parallel Offspring — Speedup & Quality Report\n\n");
  md.push_str(&format!("**threads (parallel):** {num_threads}  \n"));
  md.push_str(&format!("**wall-clock cap per run:** {WALL_CAP_MS} ms  \n"));
  md.push_str(&format!("**reps per cell:** {REPS}  \n\n"));

  let mut all_gen_speedup: Vec<f64> = Vec::new();
  let mut all_rpd: Vec<f64> = Vec::new();

  for (pi, path) in PROBLEMS.iter().enumerate() {
    md.push_str(&format!("## Problem: `{path}`\n\n"));
    md.push_str("| Objective | Seq mean gen/s | Par mean gen/s | Throughput speedup | Seq mean value | Par mean value | Quality RPD |\n");
    md.push_str("|-----------|---------------|----------------|-------------------|---------------|----------------|-------------|\n");

    for (oi, &obj) in OBJECTIVES.iter().enumerate() {
      let c = &results[pi][oi];
      let seq_gen_s: Vec<f64> = c
        .seq_gens
        .iter()
        .zip(c.seq_times.iter())
        .map(|(g, t)| g / (t / 1_000.0).max(1e-3))
        .collect();
      let par_gen_s: Vec<f64> = c
        .par_gens
        .iter()
        .zip(c.par_times.iter())
        .map(|(g, t)| g / (t / 1_000.0).max(1e-3))
        .collect();

      let mseq_gs = mean(&seq_gen_s);
      let mpar_gs = mean(&par_gen_s);
      let speedup = mpar_gs / mseq_gs.max(1e-9);

      let mseq_v = mean(&c.seq_vals);
      let mpar_v = mean(&c.par_vals);
      // RPD: positive = parallel worse (higher value = worse for minimisation objectives)
      let rpd = (mpar_v - mseq_v) / mseq_v.max(1e-9) * 100.0;

      all_gen_speedup.push(speedup);
      all_rpd.push(rpd);

      md.push_str(&format!(
        "| {} | {mseq_gs:.1} | {mpar_gs:.1} | {speedup:.2}× | {mseq_v:.4} | {mpar_v:.4} | {rpd:+.2}% |\n",
        obj_label(obj),
      ));
    }
    md.push('\n');
  }

  md.push_str("## Summary\n\n");
  md.push_str(&format!(
    "- **Mean throughput speedup:** {:.2}× (parallel generations/s ÷ sequential generations/s)\n",
    mean(&all_gen_speedup)
  ));
  md.push_str(&format!(
    "- **Mean quality RPD:** {:+.2}% (positive = parallel finds worse value within same wall-time cap)\n\n",
    mean(&all_rpd)
  ));
  md.push_str("> RPD = (parallel_value − sequential_value) / sequential_value × 100.  \n");
  md.push_str("> Both versions run until `conv_count` stagnant generations **or** the wall-time cap — whichever fires first.  \n");
  md.push_str("> A faster generation loop (parallel) can complete more generations within the cap, potentially finding a better optimum.\n");

  fs::create_dir_all("results").expect("cannot create results/");
  fs::write("results/cea-parallel-report.md", &md).expect("cannot write report");
  println!("\nReport written to results/cea-parallel-report.md");
}
