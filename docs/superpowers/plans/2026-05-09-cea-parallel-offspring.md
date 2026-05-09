# CEA Parallel Offspring Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parallelize the 2N offspring generation loop inside each CEA generation using rayon, controlled by a `threads: usize` field in `CeaConfig` (`1` = sequential, `>1` = rayon parallel), then produce a markdown comparison report on 3 × 10v×20o problems.

**Architecture:** Pre-generate 2N per-offspring sub-seeds from the master RNG (sequential, cheap), then `par_iter` over those seeds — each closure owns its `Xoshiro256StarStar` and is fully independent. The existing sequential loop survives unchanged, selected when `threads == 1`. `survive_n` (roulette selection) stays sequential. The comparison binary lives in `crates/vrppd-cea/src/bin/parallel_comparison.rs` and writes `results/cea-parallel-report.md`.

**Tech Stack:** Rust, rayon 1.x (already in workspace via `vrppd-validation`), `rand`/`rand_xoshiro` (already in `vrppd-cea`), `serde_json` (workspace dep).

---

## File Map

| File | Change |
|---|---|
| `Cargo.toml` | Add `rayon = "1"` to `[workspace.dependencies]` |
| `crates/vrppd-cea/Cargo.toml` | Add `rayon` + `serde_json` to `[dependencies]` |
| `crates/vrppd-cea/src/config.rs` | Add `threads: usize` field + `num_cpus_or` helper |
| `crates/vrppd-cea/src/coevolve.rs` | Rename current impls `*_sequential`; add `*_parallel`; branch in public wrappers |
| `crates/napi-bridge/src/wire.rs` | Add `threads: Option<u32>` to wire `CeaConfig` |
| `crates/napi-bridge/src/lib.rs` | Handle `threads` in `merge_cea_config` |
| `crates/vrppd-cea/src/bin/parallel_comparison.rs` | New comparison binary |

---

## Task 1: Add rayon dependency and `threads` field to `CeaConfig`

**Files:**
- Modify: `Cargo.toml`
- Modify: `crates/vrppd-cea/Cargo.toml`
- Modify: `crates/vrppd-cea/src/config.rs`

- [ ] **Step 1: Add rayon to workspace dependencies**

In `Cargo.toml`, add one line inside `[workspace.dependencies]` after the existing `crossbeam-channel` entry:

```toml
rayon = "1"
```

- [ ] **Step 2: Add rayon + serde_json to vrppd-cea**

In `crates/vrppd-cea/Cargo.toml`, replace the `[dependencies]` block:

```toml
[dependencies]
vrppd-core = { workspace = true }
rand = { workspace = true }
rand_xoshiro = { workspace = true }
rayon = { workspace = true }
serde_json = { workspace = true }
```

- [ ] **Step 3: Add `threads` field to `CeaConfig`**

Replace the entire contents of `crates/vrppd-cea/src/config.rs`:

```rust
//! CEA hyperparameters.
//!
//! Defaults follow Wang & Chen (2013) §5.1 / Table 1 except where the
//! adaptation notes call out a deviation. Population sizes default to 50 each
//! and convergence to 500 stagnant generations.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CeaConfig {
  /// Population size for both Pop I (diversification) and Pop II
  /// (intensification). The paper uses `SIZE_POP1 = SIZE_POP2 = 50`.
  pub population_size: usize,

  /// Number of consecutive generations without improvement of the global
  /// best before declaring convergence. WC13 default = 500.
  pub conv_count: usize,

  /// Optional wall-time cap in milliseconds. `None` means no cap. The paper
  /// uses 30 minutes (= 1 800 000 ms).
  pub wall_time_cap_ms: Option<u64>,

  /// Recombination removal-fraction range. Per WC13 §4.2.2 the fraction is
  /// sampled uniformly on `[1/10, 1/2]` per offspring.
  pub recombination_fraction_low: f64,
  pub recombination_fraction_high: f64,

  /// Probability that Pop II's local-improvement step uses Reinsertion (vs
  /// Swap). WC13 §4.2.3 says "either one" without further detail; we
  /// uniform-pick at 0.5.
  pub p_reinsertion: f64,

  /// Fraction of Pop II offspring produced by Crossover (vs by Local
  /// Improvement on a single parent). Not pinned by WC13; default 0.5
  /// gives equal weight to both pathways.
  pub p_crossover: f64,

  /// Number of rayon threads used for parallel offspring generation.
  /// `1` disables parallelism entirely (sequential loop, no rayon overhead).
  /// `>1` uses the rayon global thread pool (all available cores are used).
  pub threads: usize,
}

impl Default for CeaConfig {
  fn default() -> Self {
    Self {
      population_size: 50,
      conv_count: 500,
      wall_time_cap_ms: Some(30 * 60 * 1000),
      recombination_fraction_low: 0.1,
      recombination_fraction_high: 0.5,
      p_reinsertion: 0.5,
      p_crossover: 0.5,
      threads: num_cpus_or(2),
    }
  }
}

impl CeaConfig {
  /// A small-budget variant intended for tests and the small-instance
  /// fixtures: tiny populations, short convergence horizon, single thread
  /// for deterministic sequential behaviour.
  pub fn small_for_tests() -> Self {
    Self {
      population_size: 10,
      conv_count: 50,
      wall_time_cap_ms: Some(5_000),
      threads: 1,
      ..Self::default()
    }
  }
}

#[inline]
fn num_cpus_or(min: usize) -> usize {
  std::thread::available_parallelism()
    .map(|n| n.get().max(min))
    .unwrap_or(min)
}
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
cargo test -p vrppd-cea 2>&1 | tail -20
```

Expected: all tests pass (the new field is set in `small_for_tests()` which the tests use).

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/vrppd-cea/Cargo.toml crates/vrppd-cea/src/config.rs
git commit -m "feat(cea): add threads field to CeaConfig + rayon dependency"
```

---

## Task 2: Parallel offspring generation in `coevolve.rs`

**Files:**
- Modify: `crates/vrppd-cea/src/coevolve.rs`

- [ ] **Step 1: Write a failing test for the parallel path**

Add to the bottom of `crates/vrppd-cea/tests/cea_quality.rs`:

```rust
#[test]
fn parallel_cea_produces_valid_solution() {
  let problem = load_fixture("two_vehicles_three_orders.json");
  let mut config = CeaConfig::small_for_tests();
  config.threads = 4; // force parallel path
  config.wall_time_cap_ms = Some(5_000);

  for seed in [0_u64, 1, 2] {
    let solved = solve_cea_seeded(&problem, Objective::Distance, config, seed);
    assert!(
      solved.solution.total_distance > 0.0,
      "parallel CEA returned zero distance for seed {seed}"
    );
  }
}
```

- [ ] **Step 2: Run — expect compile error or test failure**

```bash
cargo test -p vrppd-cea parallel_cea_produces_valid_solution 2>&1 | tail -20
```

Expected: test compiles but fails because the parallel path doesn't exist yet — `threads=4` will still run the sequential loop (no branch yet), so this may pass trivially. That's fine; the real guard is the compile step after code changes.

- [ ] **Step 3: Implement the parallel helper functions in `coevolve.rs`**

At the top of `crates/vrppd-cea/src/coevolve.rs`, add the rayon import after the existing `use` block:

```rust
use rayon::prelude::*;
```

Then, in `coevolve.rs`, rename the bodies of the two private evolution functions and add parallel siblings. Replace the existing `fn evolve_pop1` and `fn evolve_pop2` with the following four functions. (The `_sequential` variants are the current bodies, verbatim; only the outer wrappers and the new `_parallel` functions are new.)

```rust
/// Evolve Population I — dispatches to sequential or parallel offspring
/// generation based on `config.threads`.
fn evolve_pop1<R: Rng + ?Sized>(
  pop: &Population,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
  config: &CeaConfig,
  rng: &mut R,
) -> Population {
  if config.threads > 1 {
    evolve_pop1_parallel(pop, problem, order_mat, vstart_mat, target, config, rng)
  } else {
    evolve_pop1_sequential(pop, problem, order_mat, vstart_mat, target, config, rng)
  }
}

/// Sequential Pop I evolution — original implementation.
fn evolve_pop1_sequential<R: Rng + ?Sized>(
  pop: &Population,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
  config: &CeaConfig,
  rng: &mut R,
) -> Population {
  let n = pop.len();
  let target_offspring = 2 * n;

  let mut offspring: Vec<Individual> = Vec::with_capacity(target_offspring);
  if let Some(elite) = reproduce_elite(pop, target) {
    offspring.push(elite);
  }

  let parent_fitness = fitness_values(&pop.individuals, target);

  while offspring.len() < target_offspring {
    let picks = roulette_select(&parent_fitness, 1, rng);
    let parent = &pop.individuals[picks[0]];
    let child = recombine(
      &parent.solution,
      problem,
      order_mat,
      vstart_mat,
      target,
      config.recombination_fraction_low,
      config.recombination_fraction_high,
      rng,
    );
    offspring.push(Individual::new(child));
  }

  survive_n(offspring, n, target, rng)
}

/// Parallel Pop I evolution — generates elite sequentially, then produces
/// the remaining offspring concurrently via rayon using pre-seeded RNGs.
fn evolve_pop1_parallel<R: Rng + ?Sized>(
  pop: &Population,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
  config: &CeaConfig,
  rng: &mut R,
) -> Population {
  let n = pop.len();
  let target_offspring = 2 * n;

  let mut offspring: Vec<Individual> = Vec::with_capacity(target_offspring);
  if let Some(elite) = reproduce_elite(pop, target) {
    offspring.push(elite);
  }

  let remaining = target_offspring - offspring.len();
  let parent_fitness = fitness_values(&pop.individuals, target);

  // Pre-generate one sub-seed per offspring slot (sequential, O(remaining)).
  let base: u64 = rng.gen();
  let sub_seeds: Vec<u64> = (0..remaining as u64).map(|i| base.wrapping_add(i)).collect();

  let parallel_children: Vec<Individual> = sub_seeds
    .into_par_iter()
    .map(|seed| {
      let mut local_rng = Xoshiro256StarStar::seed_from_u64(seed);
      let picks = roulette_select(&parent_fitness, 1, &mut local_rng);
      let parent = &pop.individuals[picks[0]];
      let child = recombine(
        &parent.solution,
        problem,
        order_mat,
        vstart_mat,
        target,
        config.recombination_fraction_low,
        config.recombination_fraction_high,
        &mut local_rng,
      );
      Individual::new(child)
    })
    .collect();

  offspring.extend(parallel_children);
  survive_n(offspring, n, target, rng)
}

/// Evolve Population II — dispatches to sequential or parallel offspring
/// generation based on `config.threads`.
fn evolve_pop2<R: Rng + ?Sized>(
  pop2: &Population,
  pop1: &Population,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
  config: &CeaConfig,
  rng: &mut R,
) -> Population {
  if config.threads > 1 {
    evolve_pop2_parallel(pop2, pop1, problem, order_mat, vstart_mat, target, config, rng)
  } else {
    evolve_pop2_sequential(pop2, pop1, problem, order_mat, vstart_mat, target, config, rng)
  }
}

/// Sequential Pop II evolution — original implementation.
#[allow(clippy::too_many_arguments)]
fn evolve_pop2_sequential<R: Rng + ?Sized>(
  pop2: &Population,
  pop1: &Population,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
  config: &CeaConfig,
  rng: &mut R,
) -> Population {
  let n = pop2.len();
  let target_offspring = 2 * n;

  let mut offspring: Vec<Individual> = Vec::with_capacity(target_offspring);
  if let Some(elite) = reproduce_elite(pop2, target) {
    offspring.push(elite);
  }
  if let Some(migrant) = reproduce_elite(pop1, target) {
    offspring.push(migrant);
  }

  let parent_fitness = fitness_values(&pop2.individuals, target);

  while offspring.len() < target_offspring {
    let r: f64 = rng.gen();
    if r < config.p_crossover && pop2.len() >= 2 {
      let picks = roulette_select(&parent_fitness, 2, rng);
      let p1 = &pop2.individuals[picks[0]].solution;
      let p2 = &pop2.individuals[picks[1]].solution;
      let child = crossover(p1, p2, problem, order_mat, vstart_mat, target, rng);
      offspring.push(Individual::new(child));
    } else {
      let picks = roulette_select(&parent_fitness, 1, rng);
      let parent = &pop2.individuals[picks[0]];
      let mut child = parent.solution.clone();
      local_improve(
        &mut child,
        problem,
        order_mat,
        vstart_mat,
        target,
        config.p_reinsertion,
        rng,
      );
      offspring.push(Individual::new(child));
    }
  }

  survive_n(offspring, n, target, rng)
}

/// Parallel Pop II evolution — elite + migrant generated sequentially,
/// remaining offspring generated concurrently via rayon.
#[allow(clippy::too_many_arguments)]
fn evolve_pop2_parallel<R: Rng + ?Sized>(
  pop2: &Population,
  pop1: &Population,
  problem: &Problem,
  order_mat: &OrderMatrix,
  vstart_mat: &VehicleStartMatrix,
  target: Objective,
  config: &CeaConfig,
  rng: &mut R,
) -> Population {
  let n = pop2.len();
  let target_offspring = 2 * n;

  let mut offspring: Vec<Individual> = Vec::with_capacity(target_offspring);
  if let Some(elite) = reproduce_elite(pop2, target) {
    offspring.push(elite);
  }
  if let Some(migrant) = reproduce_elite(pop1, target) {
    offspring.push(migrant);
  }

  let remaining = target_offspring - offspring.len();
  let parent_fitness = fitness_values(&pop2.individuals, target);
  let p_crossover = config.p_crossover;
  let p_reinsertion = config.p_reinsertion;
  let can_cross = pop2.len() >= 2;
  let individuals = &pop2.individuals;

  let base: u64 = rng.gen();
  let sub_seeds: Vec<u64> = (0..remaining as u64).map(|i| base.wrapping_add(i)).collect();

  let parallel_children: Vec<Individual> = sub_seeds
    .into_par_iter()
    .map(|seed| {
      let mut local_rng = Xoshiro256StarStar::seed_from_u64(seed);
      let r: f64 = local_rng.gen();
      if r < p_crossover && can_cross {
        let picks = roulette_select(&parent_fitness, 2, &mut local_rng);
        let p1 = &individuals[picks[0]].solution;
        let p2 = &individuals[picks[1]].solution;
        let child = crossover(p1, p2, problem, order_mat, vstart_mat, target, &mut local_rng);
        Individual::new(child)
      } else {
        let picks = roulette_select(&parent_fitness, 1, &mut local_rng);
        let parent = &individuals[picks[0]];
        let mut child = parent.solution.clone();
        local_improve(
          &mut child,
          problem,
          order_mat,
          vstart_mat,
          target,
          p_reinsertion,
          &mut local_rng,
        );
        Individual::new(child)
      }
    })
    .collect();

  offspring.extend(parallel_children);
  survive_n(offspring, n, target, rng)
}
```

- [ ] **Step 4: Run all CEA tests**

```bash
cargo test -p vrppd-cea 2>&1 | tail -30
```

Expected: all tests pass including `parallel_cea_produces_valid_solution`.

- [ ] **Step 5: Commit**

```bash
git add crates/vrppd-cea/src/coevolve.rs crates/vrppd-cea/tests/cea_quality.rs
git commit -m "feat(cea): parallel offspring generation via rayon (threads field)"
```

---

## Task 3: Wire `threads` through the napi-bridge

**Files:**
- Modify: `crates/napi-bridge/src/wire.rs`
- Modify: `crates/napi-bridge/src/lib.rs`

- [ ] **Step 1: Add `threads` to wire `CeaConfig`**

In `crates/napi-bridge/src/wire.rs`, find the `CeaConfig` struct and add `threads` as the last field:

```rust
#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct CeaConfig {
  pub population_size: Option<u32>,
  pub conv_count: Option<u32>,
  pub wall_time_cap_ms: Option<f64>,
  pub recombination_fraction_low: Option<f64>,
  pub recombination_fraction_high: Option<f64>,
  pub p_reinsertion: Option<f64>,
  pub p_crossover: Option<f64>,
  pub seed: Option<f64>,
  pub threads: Option<u32>,
}
```

- [ ] **Step 2: Handle `threads` in `merge_cea_config`**

In `crates/napi-bridge/src/lib.rs`, inside `merge_cea_config`, add before the final `base` return (after all existing `if let Some(v)` blocks):

```rust
  if let Some(v) = o.threads {
    base.threads = (v as usize).max(1);
  }
```

- [ ] **Step 3: Verify napi-bridge builds**

```bash
cargo check -p napi-bridge 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add crates/napi-bridge/src/wire.rs crates/napi-bridge/src/lib.rs
git commit -m "feat(napi-bridge): expose CeaConfig.threads to TypeScript"
```

---

## Task 4: Comparison binary, run, and report

**Files:**
- Create: `crates/vrppd-cea/src/bin/parallel_comparison.rs`

- [ ] **Step 1: Create the comparison binary**

Create `crates/vrppd-cea/src/bin/parallel_comparison.rs`:

```rust
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

  println!(
    "Running comparison: sequential (threads=1) vs parallel (threads={num_threads})"
  );
  println!("Problems: {}", PROBLEMS.len());
  println!("Objectives: {}", OBJECTIVES.len());
  println!("Reps: {REPS}, wall cap: {WALL_CAP_MS}ms each\n");

  // --- collect results ---
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
        print!("  {path} {obj_label} seq rep {rep}...", obj_label = obj_label(obj));
        let s = run_cea(&problem, obj, 1, seed);
        println!(" {:.0}ms  {:.3}  {} gens", s.time_ms, s.value, s.generations);
        results[pi][oi].seq_times.push(s.time_ms);
        results[pi][oi].seq_gens.push(s.generations as f64);
        results[pi][oi].seq_vals.push(s.value);

        print!("  {path} {obj_label} par rep {rep}...", obj_label = obj_label(obj));
        let p = run_cea(&problem, obj, num_threads, seed);
        println!(" {:.0}ms  {:.3}  {} gens", p.time_ms, p.value, p.generations);
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

  // summary table across all problem×objective cells
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
      // RPD: positive means parallel is worse (higher value for minimisation)
      let rpd = (mpar_v - mseq_v) / mseq_v.max(1e-9) * 100.0;

      all_gen_speedup.push(speedup);
      all_rpd.push(rpd);

      md.push_str(&format!(
        "| {obj} | {mseq_gs:.1} | {mpar_gs:.1} | {speedup:.2}× | {mseq_v:.4} | {mpar_v:.4} | {rpd:+.2}% |\n",
        obj = obj_label(obj),
      ));
    }
    md.push('\n');
  }

  // global summary
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
```

- [ ] **Step 2: Verify the binary compiles**

```bash
cargo build -p vrppd-cea --bin parallel_comparison --release 2>&1 | tail -20
```

Expected: compiles without errors.

- [ ] **Step 3: Run the comparison**

This takes up to `3 problems × 3 objectives × 5 reps × 2 versions × 30s = ~27 minutes` worst-case (if every run hits the wall-time cap). In practice CEA will often converge early on these instances.

```bash
cargo run -p vrppd-cea --bin parallel_comparison --release 2>&1 | tee /tmp/cea-comparison.log
```

Watch stdout for per-run progress lines. When complete, check the report:

```bash
cat results/cea-parallel-report.md
```

- [ ] **Step 4: Commit results and binary**

```bash
git add crates/vrppd-cea/src/bin/parallel_comparison.rs results/cea-parallel-report.md
git commit -m "feat(cea): parallel comparison binary + R05-parallel report"
```
