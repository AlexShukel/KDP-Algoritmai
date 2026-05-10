# MILP warm-start + bf_match extension + stale-test fix

**Status:** approved (2026-05-10)

## Motivation

R05 10×20 results show MILP losing to CEA/PSA by ~2.7× on DISTANCE and ~3.5× on PRICE, with several `milp=0` "no incumbent" cases. The formulation is correct (`bf_match` passes on N=1 and N=3), but HiGHS cannot reach a good incumbent in 60 s without a starting solution. PSA solves the same instance in ~10 ms — feeding its solution to MILP as a warm start is essentially free and should dramatically improve incumbent quality.

Two adjacent issues are bundled:
1. The inline tests in `crates/vrppd-milp/src/lib.rs:485, 497` no longer compile (missing `threads` argument added in commit 9c4f171).
2. `bf_match` only covers N=1 and N=3 — no scaling coverage between the smallest fixtures and the 10×20 production size.

## Scope

Three additive changes:

### A. Stale-test fix
Pass `1` for the new `threads: usize` parameter at the two stale call sites in `crates/vrppd-milp/src/lib.rs`. No behavioural change.

### B. Warm-started MILP (Rust-side)

**New public API in `vrppd-milp`:**

```rust
pub fn solve_milp_with_warm_start(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
    warm_start: &ProblemSolution,
) -> Result<MilpResult, MilpError>
```

`solve_milp` keeps its existing signature.

**Decoder responsibility (inside `vrppd-milp`, where the variable layout lives):**

For each vehicle's route in `warm_start.routes`:
- Compute `y_ov`: 1 for the (order, vehicle) pair that the route serves, else 0.
- Compute `x_ijv`: walk the route's stops in order. For each consecutive (stop_i, stop_j), set `x[(node_i, node_j, v)] = 1`. The first arc is from the vehicle start to the first stop's node; the last arc returns to the start (cost-zero in the model).
- Compute `q_iv`: cumulative load at each stop along the route (matching the load-tracking convention in `crates/vrppd-core/src/working.rs`).
- Compute `u_iv`: 1-based stop position (so MTZ row `u_p − u_d + 2N·y_ov ≤ 2N − 1` is satisfied).

Then call `hm.set_solution(Some(&col_values), None, None, None)` immediately before `hm.solve()`. HiGHS will treat this as a primal hint; if feasible it becomes the starting incumbent, if not HiGHS discards it silently. Tests verify it is feasible.

**Wire/TS layer:**

- `crates/napi-bridge/src/lib.rs`: add `solveMilpBothWarmStart(problem, distancePsaSolution, pricePsaSolution, milpConfig)`.
- `crates/napi-bridge/src/wire.rs`: extend `MilpConfig` only if needed (likely not — config remains `{ timeoutMs }`).
- `src/algorithms/milp/index.ts`: in the adapter, call PSA via the existing `solvePsa` napi function for DISTANCE and PRICE (PSA solve ~10 ms each), then call `solveMilpBothWarmStart` with both `ProblemSolution`s.

PSA stays a TS-side caller of the existing PSA napi binding — the `vrppd-milp` crate does not depend on `vrppd-psa` in production.

### C. bf_match extension to the full 1..7 × 1..7 grid

**Source of fixtures:** the existing `problems/<V>_<N>/0_<latest_ts>.json` files produced by `pnpm generate:problems:small`. The bf_match test discovers the file via the same "latest timestamp" pattern as `generate-problems.ts:findLatestDataset`.

**Test grid:** all 49 `(V, N)` cells in `{1..7} × {1..7}`. For each cell, two assertions: MILP-DISTANCE optimum equals BF-DISTANCE optimum, MILP-PRICE optimum equals BF-PRICE optimum. EMPTY remains excluded (per `vrppd-milp` module doc).

**Timeout:** 600 s per (cell, target). MILP must reach `Optimal` for the comparison to be valid; cells where `V * N > 25` are marked `#[ignore]` so default `cargo test` runs in reasonable time. Full sweep: `cargo test --release --test bf_match -- --ignored`.

**Warm-start coverage:** a parallel test set runs the same fixtures through `solve_milp_with_warm_start` (PSA seeds the warm-start) and asserts the same BF optima. This exercises the decoder against HiGHS feasibility-checking.

## Out of scope

- Decoding MILP solutions to `ProblemSolution` (route plans). Useful for full route validation but not required to verify the objective.
- A vrppd-bounds-style LP-LB sandwich check inside the harness.
- Any change to the EMPTY objective semantics.
- Increasing the harness MILP timeout above 60 s.

## Risk / open questions

- **HiGHS warm-start API**: `set_solution(Some(cols), None, None, None)` is the documented path (highs 2.0.0, `src/lib.rs:472`). Need to verify it accepts a column-only hint without rows/duals — fallback is to provide rows derived from the same warm-start.
- **PSA solution feasibility**: PSA always returns a complete order assignment, but the decoder still needs a `debug_assert!` for "every order present in exactly one route" to catch any future PSA bug from corrupting the warm-start.
- **Test runtime**: 49-cell grid with 600 s ceiling is up to ~16 hours worst case. Expected real runtime well under that since most cells close in seconds. The `#[ignore]` gate on `V*N > 25` (≈26 cells) keeps default `cargo test` fast.
- **R05 benchmark currently running**: implementation should happen in a git worktree (or wait for the sweep to finish) so source edits don't perturb the running benchmark's per-class `pnpm start` rebuilds.

## Acceptance criteria

1. `cargo test --release --test bf_match` passes on every non-ignored cell, both targets, both `solve_milp` and `solve_milp_with_warm_start`.
2. `cargo test --release --test bf_match -- --ignored` passes on the remaining cells within the 600 s per-test budget.
3. `cargo test --release --lib` compiles and passes (stale tests fixed).
4. Re-running R05 10×20 with the new TS adapter shows MILP DISTANCE/PRICE incumbents within ~2× of the heuristic best (versus the current ~3× / ~5×). Quantitative threshold to be calibrated from the first warm-start run.
