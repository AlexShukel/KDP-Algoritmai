# CEA Parallel Offspring Generation — Design Spec

**Date:** 2026-05-09  
**Scope:** `crates/vrppd-cea`

---

## Problem

The CEA implementation is single-threaded. Offspring generation inside each
generation (the `2N` loop in `evolve_pop1` / `evolve_pop2`) is embarrassingly
parallel — each offspring is an independent clone-and-mutate of a parent. This
leaves all but one CPU core idle throughout the run.

---

## Goal

Parallelize the 2N offspring generation step using rayon so each CPU core
produces a subset of offspring concurrently, reducing wall-clock time per
generation and therefore per run.

Keep the sequential code path alive via a `threads` field in `CeaConfig`
(`1` = sequential, `N` = parallel with N rayon threads).

---

## Design

### `CeaConfig` change

Add `threads: usize` field. Default: `max(2, num_cpus)` (mirrors `SaConfig`).
Sequential path activated when `threads == 1`.

### Parallelism mechanism — Approach A (rayon, pre-seeded per-offspring RNGs)

Before the offspring loop, derive `2N` sub-seeds from the master RNG on the
main thread (sequential, cheap). Each sub-seed is a `u64` advanced by
`wrapping_add(i)` from a base seed drawn from the master RNG.

Then replace the sequential `while offspring.len() < 2N` loop with:

```rust
let offspring: Vec<Individual> = (0..target_offspring)
    .into_par_iter()
    .map(|i| {
        let mut rng = Xoshiro256StarStar::seed_from_u64(sub_seeds[i]);
        // recombine / local_improve / crossover using &mut rng
        Individual::new(child)
    })
    .collect();
```

`survive_n` (roulette selection over the 2N pool) stays sequential — it's
O(N) and depends on the full offspring vector.

**Why reproducible:** same master seed → same sub-seeds → same offspring, regardless of thread scheduling order (rayon `collect` preserves index order).

### Rayon thread count

`rayon::ThreadPoolBuilder::new().num_threads(config.threads).build_scoped()`
wraps the parallel section. When `threads == 1`, skip rayon entirely and run
the existing sequential loop. This avoids rayon overhead for the sequential
baseline.

### Operator signatures

`recombine`, `local_improve`, and `crossover` already take `rng: &mut R` —
no signature change needed. Each parallel closure owns its local
`Xoshiro256StarStar`, satisfying the `Send` requirement for rayon.

---

## Comparison binary

`crates/vrppd-cea/src/bin/parallel_comparison.rs`

- Accepts 3 problem file paths as CLI args.
- For each problem × objective (3) × version (sequential / parallel) × 5 reps:
  runs CEA and records wall-clock time + objective value.
- Prints results to stdout and writes `results/cea-parallel-report.md`.

Report structure:
- Summary table: mean speedup and mean RPD vs sequential per objective.
- Per-problem tables: time and objective value for each rep.

---

## Testing

Existing `crates/vrppd-cea/tests/cea_quality.rs` runs sequential CEA —
keep it unchanged (sequential baseline stays correct).

Add one test: `solve_cea_seeded` with `threads=1` and `threads=N` on the
same seed and small problem → both must produce valid solutions (quality
comparison not asserted since stochasticity differs by path).

---

## Files changed

| File | Change |
|---|---|
| `crates/vrppd-cea/src/config.rs` | Add `threads: usize` field + default |
| `crates/vrppd-cea/src/coevolve.rs` | Branch on `threads`; parallel path with pre-seeded rayon loop |
| `crates/vrppd-cea/Cargo.toml` | Add `rayon` dependency |
| `Cargo.toml` | Add `rayon = "1"` to `[workspace.dependencies]` |
| `crates/vrppd-cea/src/bin/parallel_comparison.rs` | New comparison binary |
| `crates/napi-bridge/src/lib.rs` | Pass `threads` from JS config to `CeaConfig` |
