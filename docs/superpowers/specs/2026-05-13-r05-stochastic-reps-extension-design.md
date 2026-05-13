# R05 stochastic-algorithm replication extension

**Status:** Draft
**Date:** 2026-05-13
**Context:** Brainstormed during the post-PR #12 follow-up planning session.

## 1. Motivation

PR #12 merged the OR-Tools baseline, completing the PLAN.md §4.2 comparison matrix. The matrix is structurally complete but **statistically thin** at the two largest size classes:

| Class | R05 reps (CEA, PSA) | PLAN target |
|---|---|---|
| 10×20 | 5 | 10 |
| 20×50 | 3 | 10 |
| 30×100 | 2 | 10 |
| **50×200** | **1** | **10** |
| **100×500** | **1** | **10** |

PLAN.md §4.2 / §6 call for 10 replications per (algorithm, problem, objective) for stochastic algorithms — the basis for the §4.3 analyses (Wilcoxon signed-rank tests, 95% bootstrap CIs, Cohen-d effect sizes). With 1 rep at large scale, none of those analyses have statistical power at the scales most differentiating between p-SA and CEA.

The deterministic / exact algorithms (`brute-force-rust`, `lb-direct`, `lb-lp`, `milp-rust`, `or-tools-cp-sat`, `or-tools-routing`) gain nothing from extra reps and are skipped here.

## 2. Scope

**In:**

- New script `scripts/run-r05-stochastic-reps.sh` that brings `cea-rust` and `p-sa-rust` to 10 reps on classes `50_200` and `100_500`.
- Resume support: each invocation runs at most one CEA batch per class and continues from prior batch state.
- Problem-set guard: refuses to run unless `problems/{50_200,100_500}/*.json` use the canonical R05 timestamp `1778535813465`.
- Merger logic that consolidates batch files into the canonical `.reps10.json` slot when 10 reps are reached.
- Status print at end of each invocation.

**Out:**

- Re-running deterministic algorithms.
- Smaller classes (10_20, 20_50, 30_100) — current rep counts are acceptable for their analyses.
- Changes to CEA / PSA configuration (CONV_COUNT, population size, time budgets). Reuses canonical params already on `main`.
- New seed plumbing — relies on existing `thread_rng()` per-process reseeding for inter-batch independence.

## 3. Output layout

Per class directory `results/R05-{50_200,100_500}/`:

```
benchmark-results-p-sa-rust.reps10.json            # 10 reps single-shot
benchmark-results-cea-rust.reps10.batch-01.json    # 5 reps at 50×200, 2 reps at 100×500
benchmark-results-cea-rust.reps10.batch-02.json    # ...
…
benchmark-results-cea-rust.reps10.json             # Merged: 60 × 10 = 600 records, runIndex 0..9
```

The original 1-rep R05 files `benchmark-results-{cea,p-sa}-rust.json` are **untouched** — they remain the R05-canonical record. Analysis downstream should prefer `.reps10.json` for stochastic-algorithm stats at these two classes.

JSON record schema unchanged (same shape as existing R05 records: `convergenceHistory`, `execTime`, `isBatchResult`, `metrics`, `optimizationTarget`, `problemPath`, `problemSize`, `runIndex`). Batch files contain `runIndex` 0..K-1 where K is the batch size. The merger renumbers to a global `runIndex` 0..9 across the consolidated file so downstream consumers see contiguous indices.

## 4. Per-(algo, class) batch policy

Sized from R05 mean per-run wall-times:

| Algo | Class | Mean / run | Cost / full 20×3 sweep | Batch size | Batches to 10 | Wall per batch |
|---|---|---|---|---|---|---|
| PSA | 50×200 | 0.15 s | ≈3 s | 10 (single-shot) | 1 | ~1.5 min |
| PSA | 100×500 | 1.9 s | ≈38 s | 10 (single-shot) | 1 | ~19 min |
| CEA | 50×200 | 72 s (max 86 s) | ≈1.2 h | 5 | 2 | ~6 h |
| CEA | 100×500 | 351 s (max 736 s) | ≈5.9 h | 2 | 5 | ~12 h |

Per-invocation cap (default): **at most one CEA batch per class** plus all pending PSA work.

Worst-case night 1 cost: PSA × both (~20 min) + CEA × 50×200 batch 1 (~6 h) + CEA × 100×500 batch 1 (~12 h) = **~18 h** — doesn't fit one night.

Therefore the default invocation order is **PSA-both → CEA × 50_200 batch → STOP** until CEA × 50_200 reaches 10 reps; then subsequent invocations switch to **CEA × 100_500 batch** one at a time.

Night-by-night plan under the defaults:

| Night | Work | Hours |
|---|---|---|
| 1 | PSA × {50_200, 100_500} (10 reps each) + CEA × 50_200 batch 1 (5 reps) | ~6.5 |
| 2 | CEA × 50_200 batch 2 (5 reps) — merger emits `.reps10.json` for 50_200 | ~6 |
| 3 | CEA × 100_500 batch 1 (2 reps) | ~12 |
| 4 | CEA × 100_500 batch 2 | ~12 |
| 5 | CEA × 100_500 batch 3 | ~12 |
| 6 | CEA × 100_500 batch 4 | ~12 |
| 7 | CEA × 100_500 batch 5 — merger emits `.reps10.json` for 100_500 | ~12 |

Total: **7 nights**, ~73 wall-hours of CEA work.

User overrides via env var: `MAX_CEA_BATCHES_PER_INVOCATION=2` to chain two CEA batches in a single invocation (e.g., on a weekend).

## 5. Script behavior

```
bash scripts/run-r05-stochastic-reps.sh
```

Pseudocode:

```
EXPECTED_TS=1778535813465
MAX_CEA_BATCHES=${MAX_CEA_BATCHES_PER_INVOCATION:-1}

1. Problem-set guard:
   for CLASS in 50_200 100_500:
     for f in problems/$CLASS/*.json:
       basename(f) must contain $EXPECTED_TS, else abort with reference to CLAUDE.md.

2. Trap cleanup: stash all problems/* except active class; restore on exit.

3. PSA pass — for each CLASS in (50_200, 100_500):
   target = results/R05-$CLASS/benchmark-results-p-sa-rust.reps10.json
   if exists and length == 600: skip.
   else:
     stash_all_except $CLASS
     run: SKIP_ALGORITHMS=brute-force-rust,lb-direct,lb-lp,milp-rust,or-tools-cp-sat,or-tools-routing,cea-rust \
          HEURISTIC_REPETITIONS=10 \
          pnpm start
     mv results/benchmark-results-p-sa-rust.json -> target
     restore_all

4. CEA pass:
   cea_batches_run = 0
   for CLASS in (50_200, 100_500) with batch_size in (5, 2):
     if cea_batches_run >= MAX_CEA_BATCHES: break.

     existing_batches = ls results/R05-$CLASS/benchmark-results-cea-rust.reps10.batch-*.json
     done_reps = sum over existing_batches of (records / 60)

     if done_reps >= 10: 
        # already at target — try to emit merged file if not present
        merge_if_complete $CLASS
        continue
     
     batch_no = count(existing_batches) + 1
     reps_this_batch = min(batch_size, 10 - done_reps)
     
     stash_all_except $CLASS
     run: SKIP_ALGORITHMS=brute-force-rust,lb-direct,lb-lp,milp-rust,or-tools-cp-sat,or-tools-routing,p-sa-rust \
          HEURISTIC_REPETITIONS=$reps_this_batch \
          pnpm start
     mv results/benchmark-results-cea-rust.json -> results/R05-$CLASS/benchmark-results-cea-rust.reps10.batch-$(printf %02d $batch_no).json
     restore_all
     cea_batches_run += 1

     done_reps_after = done_reps + reps_this_batch
     if done_reps_after >= 10:
        merge_if_complete $CLASS

5. Status print:
   for each (class, algo): report reps_done / 10, remaining batches, est hours next.
   if any pending: print suggested next invocation command.
   if all done: print Obsidian-vault copy command per CLAUDE.md.

merge_if_complete($CLASS):
   files = sorted(glob results/R05-$CLASS/benchmark-results-cea-rust.reps10.batch-*.json)
   total_reps = sum(records / 60 across files)
   if total_reps != 10: return.
   jq -s '... concat arrays with global runIndex renumber to 0..9 ...' "${files[@]}" > target.tmp
   verify length == 600, 10 reps per (problemPath, optimizationTarget)
   mv target.tmp results/R05-$CLASS/benchmark-results-cea-rust.reps10.json
```

The script exits 0 on completion or successful partial progress. Nonzero exit only for guard failures or harness crashes.

## 6. Problem-set guard implementation

```bash
EXPECTED_TS="1778535813465"
for CLASS in 50_200 100_500; do
  shopt -s nullglob
  matches=("$PROBLEMS_DIR/$CLASS"/*"${EXPECTED_TS}"*.json)
  total=("$PROBLEMS_DIR/$CLASS"/*.json)
  if [[ ${#matches[@]} -eq 0 || ${#matches[@]} -ne ${#total[@]} ]]; then
    echo "[stochastic-reps] FATAL: problems/$CLASS does not match canonical R05 timestamp $EXPECTED_TS." >&2
    echo "                Regenerating problems would break the R05 comparison (see CLAUDE.md)." >&2
    exit 1
  fi
  shopt -u nullglob
done
```

## 7. Determinism and inter-batch independence

PSA (`pipeline.rs:33`) and CEA (`coevolve.rs:74`) both pull from `thread_rng()`, which is seeded fresh per process from OS entropy. Separate batches run in separate `pnpm start` processes, so RNG state is independent across batches — no explicit seed plumbing needed.

**CEA EMPTY-objective caveat (observed in R05):** at 20×50 and 30×100, ~50–60% of CEA × EMPTY problems return identical results across reps. This is intrinsic to the objective structure (EMPTY's solution is largely determined by which orders force empty-leg moves, which is structurally fixed by problem geometry). Not a seeding bug. Downstream stats on EMPTY at 50×200 / 100×500 will likely show similar reduced variance vs. DISTANCE / PRICE — the thesis methodology section should note this when reporting confidence intervals.

## 8. Verification

- **Per batch:** confirm new file exists at expected path; `jq '. | length'` equals `60 × batch_size`; `[.[] | .runIndex] | unique` equals `[0, ..., batch_size-1]`.
- **After CEA merger:** `length` is 600; group by `(problemPath, optimizationTarget)` and confirm each group has exactly 10 records with `runIndex` 0..9.
- **Sanity re-run:** invoking the script after all 4 (class, algo) targets are met should be a no-op (PSA targets present, CEA `.reps10.json` present) and print "all targets met".
- **Inter-batch RNG sanity:** for at least one (problem, objective) in the merged CEA × 50_200 file, the 10 `totalDistance` values should include records from each of batch-01.json and batch-02.json that are not pairwise identical.
- **Obsidian vault sync:** after all merged files exist, copy `results/R05-50_200/` and `results/R05-100_500/` to `~/Git/halo/Projects/Bachelor-VRPPD/results/` per CLAUDE.md.

## 9. Implementation order

1. Write `scripts/run-r05-stochastic-reps.sh` per §5.
2. Smoke test 1: invoke with empty `results/R05-50_200/` shadowed away — verify PSA pass produces `benchmark-results-p-sa-rust.reps10.json` with 600 records and exits cleanly.
3. Smoke test 2: with PSA targets present, invoke and verify only one CEA × 50_200 batch runs and the script exits with sensible status output.
4. Production night 1.
5. Subsequent nights as needed (6 more under defaults; fewer with `MAX_CEA_BATCHES_PER_INVOCATION=2`).

## 10. Risks

| Risk | Mitigation |
|---|---|
| Harness crashes mid-batch and leaves a partial result file at `results/benchmark-results-*.json` | The script `mv`s only after the harness exits 0; partial file remains in `results/` and is overwritten by the next successful run, not promoted to a batch slot. |
| `problems/` regenerated between batches (different timestamp on filenames) | Problem-set guard runs at the start of every invocation; aborts with CLAUDE.md reference. |
| Inter-batch RNG correlated (same outputs across separate process invocations) | Inter-batch RNG sanity in §8 surfaces this; if observed, fall back to explicit `RUST_RNG_SEED=<unix_time>` env var threaded through the napi bridge (this would be a follow-up change, out of scope for the script itself). |
| CEA × 100_500 batch exceeds 14-hour wall (worst case based on max per-run 736 s × 60 = 12.3 h) | Schedule night invocations to start no later than 6 PM; if a batch is still running at noon next day, allow it to finish (the script does not impose a wall-clock cap). |
| Forgetting the Obsidian-vault copy | Script prints the absolute `cp -r` command at the end of every invocation where state changed. |
| Forgetting to invoke the script on subsequent nights | Out of scope for this design; user-discipline issue. |

## 11. Open questions

None. All design decisions resolved via the brainstorming session 2026-05-13. Implementation plan to follow.
