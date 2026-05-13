# Follow-up: OR-Tools PARALLEL_CHEAPEST_INSERTION comparison

> Written 2026-05-12 ~00:50 to survive a session restart while the long R05
> sweep is running in the background.

## Where the world is right now

- **R05 sweep running in background.**
  - Started by `bash scripts/run-r05.sh` (background id at time of writing: `boazjiztj`).
  - Live log: `/Users/srv/Git/KDP-Algoritmai/results/R05-2026-05-12.log`
  - ETA when started: ~10–12 h. Started ~00:44 local time on 2026-05-12.
  - Writes per-class results into `results/R05-<class>/`.
  - Uses **the new fresh problem set** (filename timestamp `1778535813465`,
    generated 2026-05-12 via `pnpm generate:problems:large`).
- **Old state archived in `.archive-2026-05-12/`** (pre-existing problems +
  pre-existing R05 result dirs + pre-existing top-level
  `benchmark-results-*.json`). Do not delete until the sweep is verified.
- **`crates/vrppd-or-tools/python/solver.py`** now reads
  `OR_TOOLS_FIRST_SOLUTION` env var (default `PATH_CHEAPEST_ARC`). Default
  unchanged means the running sweep produces the baseline.
- **Plot script:** `scripts/plot-solution-quality-vs-size.py`. Defaults to
  `--results-dir results`. Lines break at gaps via NaN. A preview drawn from
  archived data lives at `results/solution-quality-vs-size.preview.png`.

## What we want to do next

The user (Alex) asked to try `PARALLEL_CHEAPEST_INSERTION` as the OR-Tools
Routing first-solution heuristic and compare it head-to-head against the
`PATH_CHEAPEST_ARC` baseline that the running sweep produces. Goal: see
whether OR-Tools Routing solution quality improves at the large classes
(esp. 50_200 and 100_500 where it currently lags badly behind CEA / P-SA).

## Execution checklist — run this after the sweep finishes

### Step 1 — Verify the sweep finished cleanly

```bash
tail -40 results/R05-2026-05-12.log
for d in R05-10_20 R05-20_50 R05-30_100 R05-50_200 R05-100_500; do
  echo "== $d =="
  ls "results/$d/"
done
```

Expected files per class (per skip rules in `scripts/run-r05.sh`):
- All classes: `cea-rust`, `lb-direct`, `or-tools-routing`, `p-sa-rust`.
- `10_20` also: `lb-lp`, `milp-rust`, `or-tools-cp-sat`.
- `20_50`, `30_100` also: `milp-rust`, `or-tools-cp-sat`.
- `50_200`, `100_500`: just the baseline four (no MILP, no CP-SAT).

### Step 2 — Snapshot the PATH_CHEAPEST_ARC baseline

```bash
for d in R05-10_20 R05-20_50 R05-30_100 R05-50_200 R05-100_500; do
  for f in or-tools-routing or-tools-cp-sat; do
    src="results/$d/benchmark-results-$f.json"
    [[ -f "$src" ]] && cp "$src" "results/$d/benchmark-results-$f.path-cheapest-arc.json"
  done
done
```

### Step 3 — Remove the originals so the OR-Tools-only re-run can write fresh ones

`scripts/run-r05-ortools-only.sh` overwrites the top-level
`results/benchmark-results-or-tools-*.json` then copies them into the class
dirs. The script does NOT short-circuit when a class already has results, but
we want a clean swap so the chart picks up only the new run's data. Remove
the originals; the `.path-cheapest-arc.json` snapshot from step 2 stays:

```bash
for d in R05-10_20 R05-20_50 R05-30_100 R05-50_200 R05-100_500; do
  rm -f "results/$d/benchmark-results-or-tools-routing.json"
  rm -f "results/$d/benchmark-results-or-tools-cp-sat.json"
done
```

### Step 4 — Re-run OR-Tools only with the new strategy

Default script skips 10_20 ("captured in an earlier pass"). For an apples-to-
apples comparison across all R05 classes we want 10_20 included. Two ways:

**Option A — quick edit:** in `scripts/run-r05-ortools-only.sh` change

```bash
declare -a CLASSES=("20_50" "30_100" "50_200" "100_500")
```
to
```bash
declare -a CLASSES=("10_20" "20_50" "30_100" "50_200" "100_500")
```
and remember to revert when done.

**Option B — leave the script alone and patch in 10_20 separately.** Skipped
for brevity here; option A is fine.

Then:

```bash
OR_TOOLS_FIRST_SOLUTION=PARALLEL_CHEAPEST_INSERTION bash scripts/run-r05-ortools-only.sh
```

ETA: ~3–5 hours (OR-Tools-only sweep, 60s/target × 3 targets × 20 problems × 5 classes,
plus CP-SAT at 10_20 only).

### Step 5 — Tag the new results

```bash
for d in R05-10_20 R05-20_50 R05-30_100 R05-50_200 R05-100_500; do
  for f in or-tools-routing or-tools-cp-sat; do
    src="results/$d/benchmark-results-$f.json"
    [[ -f "$src" ]] && mv "$src" "results/$d/benchmark-results-$f.parallel-cheapest-insertion.json"
  done
done
```

### Step 6 — Build a comparison chart

Either:
- Pass both result variants into a modified plot script that draws two
  OR-Tools Routing lines (baseline vs PARALLEL), or
- Run `scripts/plot-solution-quality-vs-size.py` twice with different
  `--results-dir` aliases and overlay manually.

Cleanest: extend `scripts/plot-solution-quality-vs-size.py` to look for
optional `*.parallel-cheapest-insertion.json` and `*.path-cheapest-arc.json`
variants and plot both as labelled lines. Output:
`results/or-tools-strategy-comparison.png`.

### Step 7 — Copy results to the Obsidian vault

Per `CLAUDE.md`:

```bash
for d in R05-10_20 R05-20_50 R05-30_100 R05-50_200 R05-100_500; do
  cp -r "results/$d" ~/Git/halo/Projects/Bachelor-VRPPD/results/
done
```

(Use the per-file copy approach if destination dirs already exist, as in the
earlier session.)

## Decision after seeing the comparison

If `PARALLEL_CHEAPEST_INSERTION` wins consistently, change the default in
`crates/vrppd-or-tools/python/solver.py` from `PATH_CHEAPEST_ARC` to
`PARALLEL_CHEAPEST_INSERTION` and commit. Otherwise leave the env-var-driven
plumbing and document the finding.

## Open items / things I might also try if the user wants

- More time per call (raise `OR_TOOLS_TIMEOUT_MS`; currently 60_000 via the
  OR-Tools-only script).
- Multi-start: run two or three different first-solution strategies inside
  one solve and return the best — needs solver.py changes beyond a single
  env-var swap.
- Inspect why OR-Tools Routing's wall-time is ~2× the configured time limit
  (probably first-solution time isn't counted against `time_limit.seconds`).
