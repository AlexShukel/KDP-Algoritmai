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
any change to the napi crate, run `pnpm install --force` before invoking
the harness. On Windows, prefix with `CI=true` to suppress pnpm's TTY
prompt. On macOS / Linux the prefix is unnecessary.

The napi binary is platform-specific (`.node` filename embeds the
target triple — `napi-bridge.darwin-arm64.node` on Apple Silicon,
`napi-bridge.darwin-x64.node` on Intel Macs, `napi-bridge.win32-x64-msvc.node`
on Windows). Always rebuild on the same machine you're benchmarking on;
copying `.node` files across platforms will not work.

### Native dependencies for `vrppd-milp`

The MILP solver (`crates/vrppd-milp`) bundles HiGHS from source, so the
**first** build of the crate needs both of the following on `PATH` (they
are not needed once the build artefacts have been cached):

- **CMake** (≥ 3.16) — for compiling HiGHS itself. Verify with
  `cmake --version`.
- **LLVM / libclang** — `highs-sys` invokes `bindgen` to generate Rust
  FFI bindings, and bindgen needs the `libclang` shared library
  (`libclang.dll` on Windows, `libclang.dylib` on macOS,
  `libclang.so` on Linux).

#### macOS setup (Apple Silicon or Intel)

```bash
# CMake.
brew install cmake

# libclang. Either of the following works:
xcode-select --install      # Apple's bundled toolchain ships libclang.dylib
brew install llvm           # newer libclang; required if Apple's is too old

# If bindgen can't auto-discover libclang on macOS, point it at one
# explicitly. Apple's lives at:
export LIBCLANG_PATH="$(xcode-select -p)/usr/lib"
# Homebrew's (Apple Silicon default prefix):
export LIBCLANG_PATH="/opt/homebrew/opt/llvm/lib"
# Homebrew's (Intel default prefix):
export LIBCLANG_PATH="/usr/local/opt/llvm/lib"
```

Verify with `cmake --version && clang --version` in a fresh shell.

#### Windows setup

```powershell
winget install Kitware.CMake
winget install LLVM.LLVM
```

`winget install LLVM.LLVM` does not always update `PATH` for shells that
are already running. Either open a fresh shell or set `LIBCLANG_PATH`
explicitly:

```bash
export LIBCLANG_PATH="C:\\Program Files\\LLVM\\bin"
```

#### Linux setup

```bash
sudo apt install cmake clang libclang-dev   # Debian / Ubuntu
sudo dnf install cmake clang clang-devel    # Fedora / RHEL
```

#### Failure modes

Without CMake the build panics from inside `highs-sys`'s build script
with a `cmake` not-found error. Without libclang, bindgen panics with
`Unable to find libclang: "couldn't find any valid shared libraries
matching: ['clang.dll', 'libclang.dll']"` (or `libclang.dylib` /
`libclang.so` on macOS / Linux respectively).

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

## OR-Tools baseline setup

The `vrppd-or-tools` crate provides two additional baselines for the
PLAN.md §4.2 comparison matrix:

- `or-tools-cp-sat` — exact CP-SAT solver, complements `milp-rust`
  with a typically tighter formulation; aims to prove optimality up
  to N ≈ 30–50.
- `or-tools-routing` — OR-Tools Routing Solver (cheapest-insertion +
  guided local search). Returns near-optimal solutions; the
  highest-quality reference available at N ∈ {100, 200, 500}.

Both solvers shell out to a Python script that uses the
`google/or-tools` package. The recommended install is a project-local
virtual environment at `.venv/` (works around PEP 668 on Homebrew
Python; the Rust crate auto-detects this venv at runtime, so no
shell-level activation is needed before `pnpm start`):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip3 install -r crates/vrppd-or-tools/python/requirements.txt
```

Verify the install:

```bash
python3 crates/vrppd-or-tools/python/solver.py --self-test
```

(After the first run, `.venv/bin/python3` is what the crate executes
regardless of whether your current shell has the venv activated.)

Both Rust functions (`solve_routing` / `solve_cp_sat`) return typed
errors (`OrtoolsImportFailed`, `PythonNotFound`) if the install is
missing — so a misconfigured environment fails fast at the first
solve, not silently.

Environment variables that affect the OR-Tools rows of `pnpm start`:

- `OR_TOOLS_TIMEOUT_MS` — per-instance timeout in milliseconds.
  Defaults to 60000. Set to e.g. `1800000` for a thesis-grade
  30-minute sweep.
- `VRPPD_ORTOOLS_PY` — override the script path. Defaults to
  `crates/vrppd-or-tools/python/solver.py` resolved relative to the
  crate's compile-time directory. Useful when the binary runs from a
  different working tree.
- `VRPPD_PYTHON3` — override the python3 interpreter. When unset the
  crate prefers `<workspace>/.venv/bin/python3` if it exists, else
  falls back to `python3` on PATH.

Integration tests for the crate require both Python and the
`ortools` package, and are gated behind `VRPPD_TEST_ORTOOLS=1`:

```bash
VRPPD_TEST_ORTOOLS=1 cargo test -p vrppd-or-tools --test integration
```

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
- **macOS thermals**: long benchmarks on a MacBook will throttle CPU
  under sustained load — keep the laptop plugged in, on a hard surface,
  and ideally close the lid (clamshell mode) only with an external
  display attached so the system doesn't aggressively idle the cores.
  An M-series chip on battery will under-report Rust solver throughput
  by 20–40% versus the same chip on AC.
- **macOS file watching**: if you're running these from inside an IDE
  with file watchers (VS Code, JetBrains), exclude `target/`,
  `problems/`, and `results/` from the watcher — the directories grow
  to gigabytes during a sweep and the watcher will spike a CPU.

---

## R05 — large-instance comparison matrix (PLAN.md §4.2)

Runs the full algorithm suite (minus brute-force, which is capped at N=7)
across the five large problem classes generated by `pnpm generate:problems:large`:
10×20, 20×50, 30×100, 50×200, 100×500.

`SKIP_ALGORITHMS=brute-force-rust` prevents the harness from touching the
existing `results/benchmark-results-brute-force-rust.json` (which holds the
small-instance optima from the R01b round).

Each class is run in isolation with a size-calibrated repetition count so
wall-time stays manageable on a single machine.  Per-class results land in
`results/R05-<class>/` for independent analysis; the top-level
`results/benchmark-results-*.json` files hold only the last class's data
after the script finishes (use the per-class directories for combined analysis).

```bash
# Prerequisite: napi binding built, problems generated.
bash scripts/run-r05.sh
```

Expected wall-time (Apple Silicon, AC power, no other heavy load):

| Class   | Reps | Approx. wall-time (p-SA + CEA dominant) |
| ------- | ---- | ---------------------------------------- |
| 10×20   | 10   | ~1 h                                     |
| 20×50   |  5   | ~2 h                                     |
| 30×100  |  3   | ~3 h                                     |
| 50×200  |  2   | ~4 h                                     |
| 100×500 |  1   | ~5 h                                     |

Run overnight or on a desktop left unattended.  Keep the machine plugged in
(see Tips § macOS thermals).

To skip MILP on the very large classes (where 60 s timeouts add up to hours
of useless waiting), extend the skip list:

```bash
SKIP_ALGORITHMS=brute-force-rust,milp-rust bash scripts/run-r05.sh
```

The `SKIP_ALGORITHMS` env var is a comma-separated list of algorithm names
as printed by the harness (`brute-force-rust`, `lb-direct`, `lb-lp`,
`milp-rust`, `or-tools-cp-sat`, `or-tools-routing`, `p-sa-rust`, `cea-rust`).
Skipped algorithms do not write their result file, so prior-round data is preserved.
