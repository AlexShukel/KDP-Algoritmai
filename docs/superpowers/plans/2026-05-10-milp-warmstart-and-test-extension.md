# MILP warm-start + bf_match extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PSA warm-start path to the HiGHS MILP solver, extend `bf_match` correctness coverage to the full 1..7 × 1..7 problem grid, and fix the two stale inline tests in `crates/vrppd-milp/src/lib.rs` so `cargo test --lib` compiles again.

**Architecture:** New `solve_milp_with_warm_start` function in `vrppd-milp` that decodes a `ProblemSolution` (from PSA) into HiGHS column primal values `(y_ov, x_ijv, q_iv, u_iv)` and passes them to `Highs::set_solution` as a starting incumbent. The TS adapter calls PSA via the existing `solveSa` napi binding, then hands the resulting `ProblemSolution`s into a new `solve_milp_both_warm_start` napi entry point. `bf_match` grows from 4 hand-written tests to a 49-cell parameterised grid sourced from `problems/<V>_<N>/0_<latest_ts>.json`, with cells where `V*N > 25` marked `#[ignore]`.

**Tech Stack:** Rust (workspace crates `vrppd-milp`, `vrppd-psa`, `napi-bridge`), `highs` 2.0 crate, `napi-rs` derive macros, TypeScript (vite-built harness adapter).

---

## Prerequisite: isolated worktree

The R05 benchmark is running in `/Users/srv/Git/KDP-Algoritmai/`. **Before Task 1**, set up a worktree:

```bash
cd /Users/srv/Git/KDP-Algoritmai
git worktree add /tmp/kdp-milp-ws -b feat/milp-psa-warmstart
cd /tmp/kdp-milp-ws
```

All subsequent paths in this plan are relative to the worktree root.

---

## Task 1: Fix stale inline tests in `vrppd-milp`

**Files:**
- Modify: `crates/vrppd-milp/src/lib.rs:485, 497`

- [ ] **Step 1: Read the broken call sites**

```bash
sed -n '480,500p' crates/vrppd-milp/src/lib.rs
```

Expected: see `solve_milp(&problem, Objective::Distance, Duration::from_secs(10)).unwrap()` and `solve_milp(&problem, Objective::Empty, Duration::from_secs(10))` — both passing 3 args to a 4-arg function.

- [ ] **Step 2: Run the failing build to confirm**

```bash
cargo test --lib --package vrppd-milp 2>&1 | tail -20
```

Expected: `error[E0061]: this function takes 4 arguments but 3 arguments were supplied` at lines 485 and 497.

- [ ] **Step 3: Pass `1` for the new `threads` parameter at both sites**

Edit `crates/vrppd-milp/src/lib.rs:485`:

```rust
    let r = solve_milp(&problem, Objective::Distance, Duration::from_secs(10), 1).unwrap();
```

Edit `crates/vrppd-milp/src/lib.rs:497`:

```rust
    assert!(matches!(
      solve_milp(&problem, Objective::Empty, Duration::from_secs(10), 1),
      Err(MilpError::UnsupportedObjective(Objective::Empty))
    ));
```

- [ ] **Step 4: Verify the lib tests now pass**

```bash
cargo test --lib --package vrppd-milp 2>&1 | tail -10
```

Expected: `test result: ok. 2 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crates/vrppd-milp/src/lib.rs
git commit -m "fix(milp): pass threads arg to solve_milp in stale inline tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Add `vrppd-psa` as a dev-dependency of `vrppd-milp`

**Files:**
- Modify: `crates/vrppd-milp/Cargo.toml`

- [ ] **Step 1: Append `vrppd-psa` to the dev-dependencies block**

Edit `crates/vrppd-milp/Cargo.toml`:

```toml
[dev-dependencies]
serde_json = { workspace = true }
vrppd-brute-force = { workspace = true }
vrppd-psa = { workspace = true }
```

- [ ] **Step 2: Verify the workspace builds**

```bash
cargo build --package vrppd-milp --tests 2>&1 | tail -5
```

Expected: clean build (warnings ok, no errors).

- [ ] **Step 3: Commit**

```bash
git add crates/vrppd-milp/Cargo.toml
git commit -m "build(milp): add vrppd-psa as dev-dependency for warm-start tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Add `solve_milp_with_warm_start` skeleton with a failing decoder test

**Files:**
- Modify: `crates/vrppd-milp/src/lib.rs` — add new public function + new module `warm_start`
- Create: `crates/vrppd-milp/src/warm_start.rs` — decoder logic

- [ ] **Step 1: Write the failing test (in `lib.rs` test module)**

Append to the `#[cfg(test)] mod tests` block in `crates/vrppd-milp/src/lib.rs`:

```rust
  #[test]
  fn warm_start_n1_matches_cold() {
    use vrppd_psa::{default_config_for, solve_pipeline_seeded};

    let problem = Problem {
      vehicles: vec![vehicle(1, 1.0, 0.0, 0.0)],
      orders: vec![order(1, (0.0, 0.0), (0.0, 0.5))],
    };

    // Cold optimum.
    let cold = solve_milp(&problem, Objective::Distance, Duration::from_secs(10), 1).unwrap();

    // PSA warm-start.
    let psa = solve_pipeline_seeded(&problem, Objective::Distance, default_config_for(Objective::Distance), 42);
    let warm = solve_milp_with_warm_start(
      &problem,
      Objective::Distance,
      Duration::from_secs(10),
      1,
      &psa.solution,
    )
    .unwrap();

    assert_eq!(warm.status, MilpStatus::Optimal);
    assert!(
      (warm.objective_value - cold.objective_value).abs() < 1e-6,
      "warm-start objective {} differs from cold {}",
      warm.objective_value,
      cold.objective_value
    );
  }
```

- [ ] **Step 2: Run the test to confirm it fails (function doesn't exist yet)**

```bash
cargo test --lib --package vrppd-milp warm_start_n1_matches_cold 2>&1 | tail -10
```

Expected: `error[E0425]: cannot find function 'solve_milp_with_warm_start'`.

- [ ] **Step 3: Add the new module declaration and stub function**

Edit `crates/vrppd-milp/src/lib.rs`:

After the `use` block at the top (around line 46), add:

```rust
mod warm_start;
```

After `solve_milp_default` (around line 154), add:

```rust
/// Solve the adapted MILP for `target` using `warm_start` as the initial
/// primal incumbent. Decodes `warm_start.routes` into HiGHS column primal
/// values `(y_ov, x_ijv, q_iv, u_iv)` and passes them via `set_solution`
/// before solving. If the warm-start is infeasible HiGHS silently discards
/// it and behaves identically to `solve_milp`.
pub fn solve_milp_with_warm_start(
  problem: &Problem,
  target: Objective,
  timeout: Duration,
  threads: usize,
  warm_start: &vrppd_core::ProblemSolution,
) -> Result<MilpResult, MilpError> {
  if matches!(target, Objective::Empty) {
    return Err(MilpError::UnsupportedObjective(target));
  }
  if problem.orders.is_empty() || problem.vehicles.is_empty() {
    return Ok(MilpResult {
      objective_value: 0.0,
      status: MilpStatus::Optimal,
      solve_time_ms: 0,
    });
  }

  let started = Instant::now();
  let model = build_milp(problem, target);
  let mut hm = model.problem.optimise(Sense::Minimise);
  hm.set_option("time_limit", timeout.as_secs_f64());
  hm.set_option("output_flag", false);
  hm.set_option("threads", threads.max(1) as i32);

  let col_values = warm_start::decode(problem, warm_start, &model.layout);
  hm.set_solution(Some(&col_values), None, None, None);

  let solved = hm.solve();
  let status = match solved.status() {
    HighsModelStatus::Optimal => MilpStatus::Optimal,
    HighsModelStatus::ReachedTimeLimit => MilpStatus::TimedOut,
    HighsModelStatus::Infeasible => return Err(MilpError::Infeasible),
    other => return Err(MilpError::SolverFailed(format!("status={other:?}"))),
  };

  let solution = solved.get_solution();
  let mut z = 0.0;
  for (col, coef) in &model.objective_coeffs {
    z += coef * solution[*col];
  }
  Ok(MilpResult {
    objective_value: z.max(0.0),
    status,
    solve_time_ms: started.elapsed().as_millis() as u64,
  })
}
```

- [ ] **Step 4: Extend `MilpModel` to carry the variable layout**

In `crates/vrppd-milp/src/lib.rs` change the `MilpModel` struct (around line 156):

```rust
struct MilpModel {
  problem: RowProblem,
  objective_coeffs: Vec<(highs::Col, f64)>,
  /// Variable layout the warm-start decoder needs to map a `ProblemSolution`
  /// back onto column indices in the same order HiGHS sees them.
  layout: ModelLayout,
}

pub(crate) struct ModelLayout {
  pub(crate) ix: NodeIndex,
  pub(crate) y: HashMap<(usize, usize), highs::Col>,
  pub(crate) x: HashMap<(usize, usize, usize), highs::Col>,
  pub(crate) q: HashMap<(usize, usize), highs::Col>,
  pub(crate) u: HashMap<(usize, usize), highs::Col>,
  /// Total number of columns added to the HiGHS model — sized so
  /// `set_solution(&col_values)` covers every column.
  pub(crate) num_cols: usize,
}
```

Make `NodeIndex` and its methods `pub(crate)` so the warm-start module can call them:

```rust
#[derive(Clone, Copy)]
pub(crate) struct NodeIndex {
  pub(crate) num_vehicles: usize,
  pub(crate) num_orders: usize,
}

impl NodeIndex {
  pub(crate) fn start(&self, v: usize) -> usize { v }
  pub(crate) fn pickup(&self, o: usize) -> usize { self.num_vehicles + o }
  pub(crate) fn delivery(&self, o: usize) -> usize { self.num_vehicles + self.num_orders + o }
  pub(crate) fn is_pickup(&self, node: usize) -> Option<usize> {
    let lo = self.num_vehicles;
    let hi = lo + self.num_orders;
    (lo..hi).contains(&node).then(|| node - lo)
  }
  pub(crate) fn is_delivery(&self, node: usize) -> Option<usize> {
    let lo = self.num_vehicles + self.num_orders;
    let hi = lo + self.num_orders;
    (lo..hi).contains(&node).then(|| node - lo)
  }
  pub(crate) fn service_nodes(&self) -> impl Iterator<Item = usize> {
    self.num_vehicles..self.num_vehicles + 2 * self.num_orders
  }
  pub(crate) fn vehicle_nodes(&self, v: usize) -> impl Iterator<Item = usize> {
    std::iter::once(self.start(v)).chain(self.service_nodes())
  }
}
```

At the end of `build_milp` change the return value to:

```rust
  let num_cols = pb.num_cols();  // verify exact accessor below
  MilpModel {
    problem: pb,
    objective_coeffs,
    layout: ModelLayout {
      ix,
      y,
      x,
      q,
      u,
      num_cols,
    },
  }
}
```

NOTE on `num_cols`: the `highs::RowProblem` API in 2.0 may not expose a getter. If `pb.num_cols()` does not compile, count manually as columns are added — track a `let mut num_cols = 0_usize;` at the top of `build_milp` and `num_cols += 1` after every `pb.add_integer_column` / `pb.add_column` call. Use whichever compiles.

Also remove the `let _ = (y, q, u);` line near the end of `build_milp` since these are now moved into the layout.

- [ ] **Step 5: Create the warm-start module stub**

Create `crates/vrppd-milp/src/warm_start.rs`:

```rust
//! Decode a `vrppd_core::ProblemSolution` into the column-primal vector
//! HiGHS expects for `Highs::set_solution`. The output ordering must match
//! the column-add order in `build_milp`: y_ov first, then x_ijv per vehicle,
//! then q_iv per vehicle, then u_iv per vehicle.

use vrppd_core::{Problem, ProblemSolution, StopKind};

use crate::ModelLayout;

/// Build a `Vec<f64>` of length `layout.num_cols` containing the warm-start
/// primal values for every column in the model.
pub(crate) fn decode(
  problem: &Problem,
  solution: &ProblemSolution,
  layout: &ModelLayout,
) -> Vec<f64> {
  let mut col_values = vec![0.0_f64; layout.num_cols];

  for (vehicle_id_str, route) in &solution.routes {
    let v = vehicle_index_for(problem, vehicle_id_str);
    if route.stops.is_empty() {
      continue;
    }

    // y_ov: 1.0 for every order this vehicle serves.
    for stop in &route.stops {
      if matches!(stop.kind, StopKind::Pickup) {
        let o = order_index_for(problem, stop.order_id);
        let col = layout.y[&(o, v)];
        col_values[col_index(col)] = 1.0;
      }
    }

    // x_ijv: walk the route, for each consecutive (i, j) set x[(i,j,v)] = 1.
    let s = layout.ix.start(v);
    let mut prev = s;
    for stop in &route.stops {
      let node = node_for_stop(problem, &layout.ix, stop);
      let col = layout.x[&(prev, node, v)];
      col_values[col_index(col)] = 1.0;
      prev = node;
    }
    // Close back to start (cost-zero arc, but the constraint Σ in == Σ out
    // requires the route to land somewhere — closing to start keeps the
    // formulation feasible).
    let col = layout.x[&(prev, s, v)];
    col_values[col_index(col)] = 1.0;

    // q_iv: cumulative load along the route. Pickups add 1/load_factor,
    // deliveries subtract.
    let mut load = 0.0_f64;
    for stop in &route.stops {
      let o = order_index_for(problem, stop.order_id);
      let factor = problem.orders[o].load_factor;
      match stop.kind {
        StopKind::Pickup => load += 1.0 / factor,
        StopKind::Delivery => load -= 1.0 / factor,
      }
      let node = node_for_stop(problem, &layout.ix, stop);
      let col = layout.q[&(node, v)];
      col_values[col_index(col)] = load;
    }

    // u_iv: 1-based stop position so MTZ holds.
    for (pos, stop) in route.stops.iter().enumerate() {
      let node = node_for_stop(problem, &layout.ix, stop);
      let col = layout.u[&(node, v)];
      col_values[col_index(col)] = (pos + 1) as f64;
    }
  }

  col_values
}

fn vehicle_index_for(problem: &Problem, vehicle_id_str: &str) -> usize {
  let id: u32 = vehicle_id_str
    .parse()
    .expect("vehicle id key must be a stringified u32");
  problem
    .vehicles
    .iter()
    .position(|v| v.id == id)
    .expect("warm-start references unknown vehicle id")
}

fn order_index_for(problem: &Problem, order_id: u32) -> usize {
  problem
    .orders
    .iter()
    .position(|o| o.id == order_id)
    .expect("warm-start references unknown order id")
}

fn node_for_stop(
  problem: &Problem,
  ix: &crate::NodeIndex,
  stop: &vrppd_core::RouteStop,
) -> usize {
  let o = order_index_for(problem, stop.order_id);
  match stop.kind {
    StopKind::Pickup => ix.pickup(o),
    StopKind::Delivery => ix.delivery(o),
  }
}

fn col_index(col: highs::Col) -> usize {
  // The `highs` crate exposes `Col` as a transparent newtype around the
  // internal column index. If the public API hides the index, switch to
  // collecting cols in insert-order and using a HashMap<Col, usize>.
  // First pass — try the most ergonomic call:
  Into::<usize>::into(col)
}
```

NOTE on `col_index`: if `highs::Col -> usize` does not exist as a `From`/`Into`, fall back to indexing via insertion order. Verify the conversion compiles in the next step; if not, restructure `ModelLayout` to store `Vec<highs::Col>` along with insertion-order positions.

- [ ] **Step 6: Run the warm-start test**

```bash
cargo test --lib --package vrppd-milp warm_start_n1_matches_cold -- --nocapture 2>&1 | tail -20
```

Expected: PASS. If it fails on `col_index` conversion, fix that first per the note above. If it fails on the assertion, dump `col_values` and the cold/warm objectives to debug.

- [ ] **Step 7: Add a second test on the N=3 fixture (broader coverage)**

Append to the same test module:

```rust
  #[test]
  fn warm_start_n3_distance_matches_bf() {
    use std::path::PathBuf;
    use vrppd_psa::{default_config_for, solve_pipeline_seeded};

    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("../vrppd-bounds/tests/fixtures/two_vehicles_three_orders.json");
    let raw = std::fs::read_to_string(&path).unwrap();
    let problem: Problem = serde_json::from_str(&raw).unwrap();

    let bf = vrppd_brute_force::solve(&problem);
    let bf_optimum = bf.best_distance_solution.total_distance;

    let psa = solve_pipeline_seeded(&problem, Objective::Distance, default_config_for(Objective::Distance), 7);
    let warm = solve_milp_with_warm_start(
      &problem,
      Objective::Distance,
      Duration::from_secs(60),
      1,
      &psa.solution,
    )
    .unwrap();

    assert_eq!(warm.status, MilpStatus::Optimal);
    assert!(
      (warm.objective_value - bf_optimum).abs() < 1e-3,
      "warm MILP {} != BF {}",
      warm.objective_value,
      bf_optimum
    );
  }
```

- [ ] **Step 8: Run the new test**

```bash
cargo test --lib --package vrppd-milp warm_start_n3_distance_matches_bf -- --nocapture 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add crates/vrppd-milp/src/lib.rs crates/vrppd-milp/src/warm_start.rs
git commit -m "feat(milp): add solve_milp_with_warm_start with PSA decoder

Decodes a ProblemSolution into HiGHS column primal values (y_ov, x_ijv,
q_iv, u_iv) and passes them via set_solution before B&B starts. Tests
verify the warm-started solver reaches the same optimum as cold MILP
on N=1 and matches brute-force on the N=3 fixture.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Extend `bf_match` to the full 1..7 × 1..7 grid

**Files:**
- Modify: `crates/vrppd-milp/tests/bf_match.rs`

- [ ] **Step 1: Add a fixture loader for `problems/<V>_<N>/` instances**

At the top of `crates/vrppd-milp/tests/bf_match.rs`, after the existing `load_fixture` helper, add:

```rust
/// Load `problems/<V>_<N>/0_<latest_ts>.json` from the repo root. Returns the
/// problem with the highest timestamp, matching the convention used by
/// `generate-problems.ts`.
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
      // Filename format: `<sample_idx>_<timestamp>.json`. We want sample 0
      // with the highest timestamp.
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
```

Also add the imports needed:

```rust
use std::path::PathBuf;
```

(Already present from existing `load_fixture`.)

- [ ] **Step 2: Add the cell-test macro**

Below the helpers, add:

```rust
macro_rules! grid_cell {
  // Default-run version.
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
  // #[ignore]'d version — for cells where V*N > 25.
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
```

The macro depends on the `paste` crate for identifier concatenation. Add it to dev-dependencies:

```toml
# crates/vrppd-milp/Cargo.toml [dev-dependencies]
paste = "1"
```

- [ ] **Step 3: Generate the 49-cell grid**

Replace the existing 4 hand-written `milp_matches_bf_*` tests at the bottom of `bf_match.rs` with the full grid:

```rust
// Generated grid: every (V, N) cell in 1..=7 × 1..=7. Cells with V*N <= 25
// run by default; the rest are #[ignore]'d so default `cargo test --release`
// runs in minutes, full sweep via `cargo test --release -- --ignored`.
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
```

- [ ] **Step 4: Add the brute-force workspace dep entry**

Verify `crates/vrppd-milp/Cargo.toml` `[dev-dependencies]` already has `vrppd-brute-force` and `vrppd-psa` (from Task 2). It does. No change needed.

- [ ] **Step 5: Run the default-grid tests**

```bash
cargo test --release --test bf_match 2>&1 | tail -20
```

Expected: roughly `40+ passed; 0 failed; 18 ignored` (exact counts depend on macro expansion). Wall time: a few minutes.

- [ ] **Step 6: Run the ignored cells (optional during plan execution; mandatory before merge)**

```bash
cargo test --release --test bf_match -- --ignored 2>&1 | tail -10
```

Expected: all ignored tests PASS within the 600 s per-test budget. If any time out, leave them `#[ignore]`d and document in the spec.

- [ ] **Step 7: Commit**

```bash
git add crates/vrppd-milp/Cargo.toml crates/vrppd-milp/tests/bf_match.rs
git commit -m "test(milp): extend bf_match to full 1..7 × 1..7 grid

Replaces 4 hand-written N=1/N=3 tests with a macro-generated 49-cell
grid sourced from problems/<V>_<N>/0_<latest_ts>.json. Each cell asserts
both cold solve_milp and warm-started solve_milp_with_warm_start match
the brute-force optimum on DISTANCE and PRICE. Cells where V*N > 25 are
#[ignore]'d so default cargo test --release stays fast.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Wire the warm-start through `napi-bridge`

**Files:**
- Modify: `crates/napi-bridge/src/lib.rs`
- Modify: `crates/napi-bridge/src/wire.rs` (only if a new wire type is needed — likely no)

- [ ] **Step 1: Add `solve_milp_both_warm_start` napi entry point**

Append to `crates/napi-bridge/src/lib.rs` after the existing `solve_milp_both` (line 126):

```rust
/// Same as `solve_milp_both` but seeds each per-target HiGHS solve with the
/// supplied PSA solution as a starting incumbent. Caller must pass the PSA
/// solution computed for the matching target (DISTANCE warm-start for the
/// DISTANCE solve, PRICE warm-start for the PRICE solve).
#[napi]
pub fn solve_milp_both_warm_start(
  problem: Problem,
  distance_warm_start: ProblemSolution,
  price_warm_start: ProblemSolution,
  config: Option<MilpConfig>,
) -> Result<MilpBothResult> {
  let core_problem: vrppd_core::Problem = problem.into();
  let timeout = match config.as_ref().and_then(|c| c.timeout_ms) {
    Some(ms) if ms > 0.0 => std::time::Duration::from_millis(ms as u64),
    _ => vrppd_milp::DEFAULT_TIMEOUT,
  };
  let threads_each = std::thread::available_parallelism()
    .map(|n| (n.get() / 2).max(1))
    .unwrap_or(1);

  let p_dist = core_problem.clone();
  let p_price = core_problem;
  let dist_ws: vrppd_core::ProblemSolution = distance_warm_start.into();
  let price_ws: vrppd_core::ProblemSolution = price_warm_start.into();

  let h_dist = std::thread::spawn(move || {
    vrppd_milp::solve_milp_with_warm_start(&p_dist, Objective::Distance, timeout, threads_each, &dist_ws)
  });
  let h_price = std::thread::spawn(move || {
    vrppd_milp::solve_milp_with_warm_start(&p_price, Objective::Price, timeout, threads_each, &price_ws)
  });

  let dist = h_dist
    .join()
    .map_err(|_| Error::new(Status::GenericFailure, "MILP DISTANCE thread panicked"))?
    .map_err(|e| Error::new(Status::GenericFailure, format!("MILP DISTANCE: {e}")))?;
  let price = h_price
    .join()
    .map_err(|_| Error::new(Status::GenericFailure, "MILP PRICE thread panicked"))?
    .map_err(|e| Error::new(Status::GenericFailure, format!("MILP PRICE: {e}")))?;

  Ok(MilpBothResult {
    distance: MilpResult {
      value: dist.objective_value,
      status: milp_status_str(dist.status),
      solve_time_ms: dist.solve_time_ms as f64,
    },
    price: MilpResult {
      value: price.objective_value,
      status: milp_status_str(price.status),
      solve_time_ms: price.solve_time_ms as f64,
    },
  })
}
```

- [ ] **Step 2: Verify ProblemSolution has a wire ↔ core conversion**

```bash
grep -n "From<ProblemSolution> for vrppd_core::ProblemSolution\|impl From.*ProblemSolution" crates/napi-bridge/src/wire.rs
```

If only `core → wire` exists (lines 325–333), add the `wire → core` direction. After the `From<vrppd_core::ProblemSolution> for ProblemSolution` impl in `wire.rs`, append:

```rust
impl From<RouteStop> for vrppd_core::RouteStop {
  fn from(w: RouteStop) -> Self {
    Self {
      order_id: w.order_id,
      kind: vrppd_core::StopKind::from_str(&w.type_)
        .expect("RouteStop type must be 'pickup' or 'delivery'"),
    }
  }
}

impl From<VehicleRoute> for vrppd_core::VehicleRoute {
  fn from(w: VehicleRoute) -> Self {
    Self {
      stops: w.stops.into_iter().map(Into::into).collect(),
      total_distance: w.total_distance,
      empty_distance: w.empty_distance,
      total_price: w.total_price,
    }
  }
}

impl From<ProblemSolution> for vrppd_core::ProblemSolution {
  fn from(w: ProblemSolution) -> Self {
    Self {
      routes: w.routes.into_iter().map(|(k, v)| (k, v.into())).collect(),
      total_distance: w.total_distance,
      empty_distance: w.empty_distance,
      total_price: w.total_price,
    }
  }
}
```

NOTE: verify `vrppd_core::StopKind::from_str` exists. If not, hand-roll the match: `match w.type_.as_str() { "pickup" => StopKind::Pickup, "delivery" => StopKind::Delivery, other => panic!("unknown stop kind {other:?}") }`.

- [ ] **Step 3: Build the napi crate**

```bash
cd crates/napi-bridge && pnpm build 2>&1 | tail -10
```

Expected: clean build; `index.js` and `index.d.ts` regenerated containing the new `solveMilpBothWarmStart` symbol.

- [ ] **Step 4: Verify the new symbol is exported**

```bash
grep -n "solveMilpBothWarmStart" crates/napi-bridge/index.d.ts
```

Expected: a function declaration at one line in the .d.ts.

- [ ] **Step 5: Commit**

```bash
git add crates/napi-bridge/src/lib.rs crates/napi-bridge/src/wire.rs crates/napi-bridge/index.d.ts crates/napi-bridge/index.js
git commit -m "feat(napi-bridge): expose solveMilpBothWarmStart to TS

Wraps vrppd_milp::solve_milp_with_warm_start, splitting DISTANCE and
PRICE across two OS threads exactly like solveMilpBoth. Adds wire-to-core
conversions for ProblemSolution / VehicleRoute / RouteStop so the TS
adapter can pass PSA's solution back into Rust.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Update the TS MILP adapter to use PSA → warm-started MILP

**Files:**
- Modify: `src/algorithms/milp/index.ts`

- [ ] **Step 1: Read the current adapter**

```bash
sed -n '1,80p' src/algorithms/milp/index.ts
```

- [ ] **Step 2: Replace the adapter with the warm-started version**

Edit `src/algorithms/milp/index.ts` to import the PSA solver and the new warm-start binding:

```typescript
import { solveMilpBothWarmStart, solvePSa } from 'napi-bridge';
import type { AlgorithmSolution, ProblemSolution } from 'napi-bridge';
```

Verify the exact PSA function name in `crates/napi-bridge/index.d.ts`:

```bash
grep -E "solvePSa|solvePsa|solve_p_sa" crates/napi-bridge/index.d.ts
```

(napi-rs converts `solve_p_sa` to `solvePSa` or `solvePsa` depending on version.)

Update the `solve` method to call PSA twice (DISTANCE and PRICE) before the MILP call:

```typescript
async solve(
    problem: Problem,
    _config: AlgorithmConfig,
): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
    const psaDistance = solvePSa(problem, 'DISTANCE', undefined);
    const psaPrice = solvePSa(problem, 'PRICE', undefined);

    const result = solveMilpBothWarmStart(
        problem,
        psaDistance.solution,
        psaPrice.solution,
        { timeoutMs: this.timeoutMs },
    );

    if (result.distance.status !== 'OPTIMAL') {
        console.warn(
            `milp-rust: timed out on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                `target=DISTANCE after ${this.timeoutMs}ms — recording best primal incumbent`,
        );
    }
    if (result.price.status !== 'OPTIMAL') {
        console.warn(
            `milp-rust: timed out on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                `target=PRICE after ${this.timeoutMs}ms — recording best primal incumbent`,
        );
    }

    const solution: AlgorithmSolution = {
        bestDistanceSolution: { ...EMPTY_SOLUTION, totalDistance: result.distance.value },
        bestPriceSolution: { ...EMPTY_SOLUTION, totalPrice: result.price.value },
        bestEmptySolution: EMPTY_SOLUTION,
    };

    return { solution, history: [] };
}
```

- [ ] **Step 3: Type-check the harness**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: no errors. If `solvePSa` is named differently in `index.d.ts`, adjust the import.

- [ ] **Step 4: Smoke-test on a single tiny instance**

```bash
HEURISTIC_REPETITIONS=1 SKIP_ALGORITHMS="brute-force-rust,lb-lp,p-sa-rust,cea-rust,lb-direct" pnpm start 2>&1 | grep -E "milp-rust|Saved|Error" | head -20
```

(With problems/ pointing to a small class — temporarily symlink or stash in the same way `run-r05.sh` does, or just run on whatever is in problems/ today.)

Expected: at least one MILP run completes without panic; the per-instance MILP wall-time is ~10 ms longer than before (PSA overhead) and the recorded objective values are noticeably better than the cold baseline.

- [ ] **Step 5: Commit**

```bash
git add src/algorithms/milp/index.ts
git commit -m "feat(milp-adapter): seed MILP with PSA warm-start

Calls solvePSa for DISTANCE and PRICE (~10ms each) and feeds both
ProblemSolutions into solveMilpBothWarmStart. The cold baseline was
returning incumbents 2.7-3.5x worse than CEA/PSA on R05 10x20; the
warm-start should narrow that gap by giving HiGHS a feasible starting
incumbent before B&B begins.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Final verification + push

- [ ] **Step 1: Run all default tests across the workspace**

```bash
cargo test --release --workspace 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 2: Run the ignored bf_match cells (the full grid)**

```bash
cargo test --release --test bf_match -- --ignored 2>&1 | tail -10
```

Expected: all PASS within the 600 s per-test budget.

- [ ] **Step 3: Push the branch (if user explicitly asks)**

```bash
git push -u origin feat/milp-psa-warmstart
```

Do not push without explicit user instruction.

- [ ] **Step 4: Optional: re-run R05 10×20 with the warm-started build to measure the improvement**

After the user's R05 sweep finishes in main, merge `feat/milp-psa-warmstart` and re-run:

```bash
bash scripts/run-r05.sh
```

Compare new MILP DISTANCE/PRICE incumbents against the cold baseline at `results/R05-10_20/`. Acceptance criterion #4 from the spec.

---

## Self-review

- **Spec coverage**: A → Task 1; B (Rust core) → Tasks 2–3; B (wire/TS) → Tasks 5–6; C → Task 4; final R05 verification → Task 7.4. All spec sections covered.
- **Placeholder scan**: no TBD/TODO/handwave in steps. Two spots flagged as "verify the API in 2.0" (col_index, num_cols) with a documented fallback — these are real API uncertainties, not placeholders.
- **Type consistency**: `solve_milp_with_warm_start` signature consistent across Tasks 3, 5, 6. `MilpBothResult` shape unchanged so `solveMilpBothWarmStart` returns the same struct as `solveMilpBoth`.
- **Granularity**: each step is ≤5 minutes of focused work; commit boundaries align with logically complete units.
