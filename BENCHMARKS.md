# Long-running benchmarks

Anything in this file is **slow** — minutes to hours of compute. The day-to-day
test suite (`pnpm test`, `cargo test --workspace`) does not need any of this.
Use these recipes when you want empirical numbers, e.g. for the thesis chapter.

All commands assume you've already done the one-time setup:

1. Built the napi binding: `cd crates/napi-bridge && pnpm i && pnpm build`
2. Installed root deps: `cd ../.. && pnpm i`
3. Generated the problem bank (see [Generating problem instances](#generating-problem-instances))

The `--force` reinstall trick: `pnpm`'s `file:` dependency cache for
`crates/napi-bridge` doesn't always pick up rebuilt `.node` binaries. After
any change to the napi crate, run `pnpm install --force` (with `CI=true`
prefix on Windows to suppress the TTY prompt) before invoking the harness.

### Native dependencies for `vrppd-milp`

The MILP solver (`crates/vrppd-milp`) bundles HiGHS from source, so the
**first** build of the crate needs both of the following on `PATH` (they
are not needed once the build artefacts have been cached):

- **CMake** (≥ 3.16) — for compiling HiGHS itself. Install via
  `winget install Kitware.CMake` on Windows, or via your distro's package
  manager. Verify with `cmake --version`.
- **LLVM / libclang** — `highs-sys` invokes `bindgen` to generate Rust FFI
  bindings, and bindgen needs `libclang.dll`. Install via
  `winget install LLVM.LLVM` on Windows, or `apt install libclang-dev`
  (or equivalent) on Linux.

`winget install LLVM.LLVM` does not always update `PATH` for shells that
are already running. Either open a fresh shell or set `LIBCLANG_PATH`
explicitly:

```bash
export LIBCLANG_PATH="C:\\Program Files\\LLVM\\bin"
```

Without these, the build fails with either a `cmake` panic or
`Unable to find libclang: "couldn't find any valid shared libraries matching: ['clang.dll', 'libclang.dll']"`.

---

## Generating problem instances

The harness reads every `*.json` under `./problems/` and runs every registered
algorithm against each one. The generator is split in two:

```bash
pnpm generate:data             # one-time: parse seed-dataset.csv → data/orders_*.json + data/vehicles_*.json
pnpm generate:problems         # default: small grid (1×1 .. 7×7) + large classes (Phase 1.2)
pnpm generate:problems:small   # only the small grid (490 instances)
pnpm generate:problems:large   # only the large classes (120 instances) — Phase 1.2
```

Output lives under `./problems/<vCount>_<oCount>/<i>_<timestamp>.json`. The
directory is gitignored — it's regenerated on demand.

| Mode    | Classes                                                    | Total instances |
| ------- | ---------------------------------------------------------- | --------------- |
| `small` | 49 size combinations 1×1 to 7×7, 10 samples each           | 490             |
| `large` | 10×10, 10×20, 20×50, 30×100, 50×200, 100×500, 20 samples each | 120          |
| `all`   | both                                                        | 610             |

The generator auto-discovers the latest `data/orders_*.json` and
`data/vehicles_*.json` by filename timestamp, so you don't have to edit
hard-coded paths after re-running `pnpm generate:data`.

---

## p-SA parity benchmark (PLAN.md §1.1)

Quantifies how the Rust port (`crates/vrppd-psa`, exposed via `napi-bridge`)
compares against the original NodeJS p-SA on the existing problem bank.

**Cost:** roughly **a few hours** on a 7×7-capped run (490 problems × 3 objectives
× 10 reps × 2 algorithms ≈ 29 400 runs). Most of the time is the JS p-SA on
the 7×7 instances; the Rust port runs ~3× faster.

```bash
# 1. Smoke check that the napi binding works (5 seconds)
pnpm parity:smoke

# 2. Run the full benchmark — both algorithms, all problems, 10 reps each
pnpm start
# Writes:
#   dist/benchmark-results-brute-force-rust.json   (single record per problem × target)
#   dist/benchmark-results-p-sa-js.json
#   dist/benchmark-results-p-sa-rust.json

# 3. Generate the parity report
pnpm parity:compare \
  dist/benchmark-results-p-sa-js.json \
  dist/benchmark-results-p-sa-rust.json \
  --out parity-report.md
```

Output is markdown: per-objective overall stats, per-(size, objective) tables,
and a "verdict" line for each objective. RPD is computed against the better
of the two implementations on each paired run, so a 0% RPD entry is a tie.

**To run on a subset only**, temporarily move some size directories out of
`./problems/`. The harness has no built-in filter flag — keeping it simple
beats accumulating CLI surface for one-off needs.

---

## Larger-instance benchmarks (PLAN.md §1.1 + §1.2 follow-up)

Once Phase 1.2's large classes exist, the same parity flow applies but with
significantly higher per-run cost. Rough rule of thumb based on the TS p-SA:
the inner loop is ~O(N²) per iteration; doubling N quadruples per-iteration
work. Plan accordingly.

| Largest class | Approx. wall time per (algorithm, problem, target, rep) |
| ------------- | -------------------------------------------------------- |
| 7×7           | seconds                                                  |
| 30×100        | tens of seconds                                          |
| 50×200        | minutes                                                  |
| 100×500       | tens of minutes (TS) / minutes (Rust)                    |

For the very large instances, drop `HEURISTIC_REPETITIONS` in
`src/index.ts` from 10 to 1–3 unless the run is left overnight.

---

## Bound validation sweep (PLAN.md §3.4)

Closes Phase 3 by producing the per-instance soundness / tightness CSV for
the bounds chapter of the thesis. For every problem under `--problems`
whose order count is `≤ --max-n`, runs:

- brute-force (the optimum reference);
- LP-relaxation lower bound (`vrppd-bounds`);
- exact MILP (`vrppd-milp`, with a per-instance wall-clock timeout).

**Cost:** roughly **30–120 minutes** on the small bank (`max_n=7`, ~490
instances × 2 objectives ≈ 980 rows). MILP per-instance time grows
quickly with N — at N=3 the median is ~150 ms; at N=7 expect a few
seconds. Soundness/match counts and LP-ratio statistics print to stdout
at the end so a copy-paste into a thesis table is one step.

```bash
# 1. Smoke run on N ≤ 3 — finishes in ~5 minutes, validates wiring.
cargo run -p vrppd-validation --bin bound-sweep --release -- \
  --problems problems/problems --max-n 3 \
  --milp-timeout-secs 30 \
  --output results/bound_sweep_n3.csv

# 2. Full small-bank sweep — leave running, ~1–2 h.
cargo run -p vrppd-validation --bin bound-sweep --release -- \
  --problems problems/problems --max-n 7 \
  --milp-timeout-secs 60 \
  --output results/bound_sweep_n7.csv
```

CSV columns: `instance, n, v, objective, bf_optimum, lp_lb, lp_ratio,
milp_value, milp_status, milp_time_ms, sound, milp_matches_bf`. The
`results/` directory is gitignored — copy any thesis-bound CSV out of
the repo or commit a summary table instead.

The sweep skips `Objective::Empty` because both LP and MILP define EMPTY
in terms of the §2.4 formula (an upper bound on the implementation's
load-aware empty distance, not a matching quantity); see
`documents/MILP_adaptation_notes.md` for the derivation.

---

## Tips

- **Memory**: `pnpm start` already passes `--max-old-space-size=12288` (12 GB).
  If you trim it, expect OOM on the larger instances.
- **CPU**: the JS p-SA spawns `max(2, num_cpus)` worker threads per
  optimisation target call. The Rust pipeline does the same. Don't run two
  benchmarks in parallel on the same machine — they'll just thrash each other.
- **Reproducibility**: the Rust solver accepts a `seed` in `PsaConfig` and the
  generator uses fresh `Math.random` per run; if you need exactly the same
  problem set across re-generations, copy `./problems/` aside instead of
  regenerating.
- **Output size**: each `BenchmarkRecord` carries an optional convergence
  trace. The harness already samples it down to ~100 points per run, but
  10 000-record results files can still be 10s of MB. Compress before shipping.

---

## Future benchmarks (placeholder)

When new analyses land they should be documented here:

- Phase 2: CEA vs p-SA quality on the same instances + objective set.
- Phase 3: lower-bound tightness (LP-LB / direct-sum vs exact optima where
  available).
- Phase 4: scale-vs-quality and runtime-vs-N curves.
