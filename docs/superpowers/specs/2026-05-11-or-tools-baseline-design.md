# OR-Tools baseline crate (`vrppd-or-tools`) — design

**Status:** Proposed
**Author:** Aleksandras Šukelovič (with Claude)
**Date:** 2026-05-11

## 1. Motivation

`vrppd-milp` (HiGHS branch-and-cut on the adapted MILP from
`documents/MILP_adaptation_notes.md`) is the project's exact baseline.
Its practical ceiling on a 16 GB machine is ~N=30 (proven optimum)
and ~N=50 with timeout/incumbent results; instances at N=200 and
above OOM during model construction, which is why
`scripts/run-r05.sh` already skips `milp-rust` for the larger R05
classes.

PLAN.md §4.2's comparison matrix therefore has a gap from N≈50 upward:
the only references at those scales are the trivial direct-sum lower
bound (very loose), the LP relaxation lower bound (only computable
up to N≈20 with the pure-Rust `microlp` backend), and the two
metaheuristics being evaluated (p-SA, CEA). There is no
high-quality reference point to compare the metaheuristics against
at the scales that matter most for the thesis.

This spec adds a new crate, `vrppd-or-tools`, that uses Google
OR-Tools to provide two additional baselines:

- **OR-Tools Routing Solver** (`solve_routing`) — specialized VRP/PDP
  solver based on cheapest-insertion + guided local search. Scales
  to N=500+. Returns best-known solutions; cannot prove optimality.
  Serves as a **near-optimal reference** for the large-N rows of the
  comparison matrix.
- **OR-Tools CP-SAT** (`solve_cp_sat`) — exact constraint-programming
  solver. Often outperforms branch-and-cut on combinatorial routing
  problems. Aims to extend the **proven-optimal** range above what
  HiGHS can reach (~N=30–50, instance-dependent).

The two solvers cover complementary axes: CP-SAT widens the exact
range; Routing fills the large-N gap.

## 2. Goals and non-goals

### Goals

- New workspace crate `vrppd-or-tools` providing
  `solve_routing(problem, target, timeout, threads)` and
  `solve_cp_sat(problem, target, timeout, threads)`.
- API shape mirrors `vrppd-milp`'s `solve_milp` so the harness's
  existing patterns (per-target dispatch, status enum, `solve_time_ms`)
  carry over.
- DISTANCE and PRICE objectives supported on the adapted MILP from
  `documents/MILP_adaptation_notes.md`.
- Two algorithm names in the TS harness: `or-tools-routing` and
  `or-tools-cp-sat`, each producing its own
  `benchmark-results-<name>.json` like the existing baselines.
- Default 30-minute per-instance timeout (`DEFAULT_TIMEOUT`),
  matching `vrppd-milp` and PLAN.md §3.3.
- Integration via Python subprocess (Rust spawns `python3
  python/solver.py` per call, JSON over stdin/stdout).
- Empty-problem and EMPTY-objective short-circuits matching
  `vrppd-milp` exactly.

### Non-goals

- **EMPTY objective.** Same rationale as `vrppd-milp`: the §2.4
  formula does not match the implementation's load-aware empty
  distance. `solve_routing` and `solve_cp_sat` both return
  `Err(OrToolsError::UnsupportedObjective(Objective::Empty))`.
- **Warm-start from PSA.** Deferred. The crate ships with cold-start
  only. The Routing Solver's `ReadAssignmentFromRoutes` and CP-SAT's
  `AddHint` are natural extensions but not part of v1.
- **Native Rust bindings to OR-Tools C++.** Subprocess only;
  `cxx`/`bindgen` is explicitly deferred.
- **Replacing `vrppd-milp`.** Both crates stay. `vrppd-milp` remains
  the canonical baseline at N≤30; `vrppd-or-tools` extends the
  reference range.
- **Persistent Python worker / batched solves.** Spawn-per-call only.
  The ~200–500 ms startup is negligible against the 60–1800 s
  per-instance solve budgets used in the comparison matrix.

## 3. Crate layout

```
crates/vrppd-or-tools/
├── Cargo.toml             # depends on vrppd-core, serde, serde_json
├── README.md              # install + run instructions
├── python/
│   ├── solver.py          # OR-Tools driver (Routing + CP-SAT)
│   └── requirements.txt   # `ortools>=9.10,<10` (final pin verified at install)
└── src/
    ├── lib.rs             # public API, subprocess plumbing
    └── wire.rs            # JSON request/response types (serde)
```

Workspace member alongside the other `vrppd-*` crates. The crate is
registered in the root `Cargo.toml` under `[workspace.members]` and
`[workspace.dependencies]`. No native build deps; `cargo build`
succeeds on a fresh checkout without Python installed.

The Python script lives in a sibling `python/` directory rather than
embedded as a string resource so it can be run standalone for
debugging (`python3 python/solver.py < req.json`) and reviewed as
plain code in PRs.

**Script-path resolution.** At runtime the Rust side resolves the
script path as:

```rust
std::env::var("VRPPD_ORTOOLS_PY")
    .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/python/solver.py").to_string())
```

`CARGO_MANIFEST_DIR` is baked at compile time, which works for the
in-repo workflows (`pnpm start`, `cargo test`). The
`VRPPD_ORTOOLS_PY` override exists for deployed/release runs where
the script may live elsewhere relative to the binary.

## 4. Python subprocess protocol

### Request (Rust → Python, stdin)

```json
{
  "solver": "routing" | "cp_sat",
  "objective": "DISTANCE" | "PRICE",
  "timeout_ms": 1800000,
  "threads": 8,
  "problem": {
    "vehicles": [
      { "id": 1, "start_lat": 54.6872, "start_lon": 25.2797, "price_km": 1.2 },
      ...
    ],
    "orders": [
      { "id": 1,
        "pickup_lat": 54.6872, "pickup_lon": 25.2797,
        "delivery_lat": 54.7000, "delivery_lon": 25.3000,
        "load_factor": 1.0 },
      ...
    ]
  }
}
```

The Python script recomputes Haversine distances from lat/lon —
distance matrices are not sent over the wire. The Python
implementation of Haversine is a one-time port of
`vrppd-core::haversine_km`, kept in `solver.py` next to its
consumers.

### Response (Python → Rust, stdout)

Success:

```json
{
  "ok": true,
  "objective_value": 1234.567,
  "status": "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "FAILED" | "TIMED_OUT",
  "solver_runtime_ms": 12345
}
```

Failure (script catches all exceptions):

```json
{
  "ok": false,
  "error_kind": "ortools_import" | "invalid_request" | "solver_internal",
  "error_msg": "..."
}
```

Process exit code on failure is non-zero so spawn errors are also
caught when stdout parsing fails.

### Status mapping

The Python side translates each native status into one of the five
strings above; the Rust side then maps those five into the typed
`OrToolsStatus` enum (three variants, see §5).

| Source | OR-Tools native | Wire status | Rust `OrToolsStatus` |
|---|---|---|---|
| CP-SAT | `OPTIMAL` | `OPTIMAL` | `Optimal` (proven) |
| CP-SAT | `FEASIBLE` (timed out with incumbent) | `FEASIBLE` | `Feasible` |
| CP-SAT | `INFEASIBLE` | `INFEASIBLE` | (mapped to `Err(Infeasible)`) |
| CP-SAT | `UNKNOWN`, `MODEL_INVALID` | `FAILED` | (mapped to `Err(SolverFailed)`) |
| Routing | `ROUTING_SUCCESS` (within budget) | `FEASIBLE` | `Feasible` |
| Routing | timeout w/ incumbent | `FEASIBLE` | `Feasible` |
| Routing | timeout, no incumbent | `TIMED_OUT` | `TimedOut` |
| Routing | exhausted, no incumbent | `FAILED` | (mapped to `Err(SolverFailed)`) |

**Routing never returns `Optimal`.** The thesis must treat
`or-tools-routing` outputs as best-known references, not ground truth.

### Modeling notes (inside `solver.py`)

**Routing:**

- `pywrapcp.RoutingIndexManager(num_nodes, num_vehicles, starts, ends)`
  with each vehicle's start node distinct (mirrors the
  per-vehicle node set `L_v` used in `vrppd-bounds` and
  `vrppd-milp`).
- Pickup-delivery pairs via `AddPickupAndDelivery(p_idx, d_idx)` plus
  `solver.Add(routing.VehicleVar(p) == routing.VehicleVar(d))` and
  `solver.Add(distance_dim.CumulVar(p) <= distance_dim.CumulVar(d))`
  to encode precedence.
- Capacity via a Demand callback (+weight at pickup, −weight at
  delivery), with vehicle capacity = `MAX_LOAD = 1.0` scaled to
  integers (1e6 factor matches the distance scaling).
- Cost callback: `distance(i,j) * objective_weight(v, target)`, where
  `objective_weight` is `1.0` for DISTANCE and `vehicle.price_km`
  for PRICE — same logic as `vrppd_milp::objective_weight`.
- Search strategy: `PATH_CHEAPEST_ARC` first solution,
  `GUIDED_LOCAL_SEARCH` metaheuristic.
- `time_limit.seconds = timeout_ms // 1000` on the search
  parameters; sub-second budgets are rounded up to 1 s.

**CP-SAT:**

- Same MILP constraints as `vrppd-milp` (§4.4 of
  `documents/MILP_adaptation_notes.md`), reformulated into CP-SAT
  primitives:
  - `y_ov`, `x_ijv` → `model.NewBoolVar`.
  - `q_iv`, `u_iv` → `model.NewIntVar(0, ub, name)`.
  - Linear constraints (assignment, tour-start, servicing,
    precedence, capacity flow, MTZ subtour) → `model.Add(...)`.
- All real-valued coefficients (distances, prices, load factors)
  scaled to integers by 1e6 since CP-SAT is integer-only.
  Objective scaled by the same factor; Python divides back before
  emitting `objective_value`.
- `solver.parameters.num_workers = threads`,
  `solver.parameters.max_time_in_seconds = timeout_ms / 1000`,
  `solver.parameters.log_search_progress = False`.

### Distance scaling rationale

Both solvers consume integer distances. The 1e6 scale factor gives
sub-millimetre precision on lat/lon-derived kilometres, which is
well below the noise floor of the rest of the pipeline (Haversine
itself is a great-circle approximation of road distance — the
project already accepts >1% modeling error there). Accumulated
round-off across N=500 legs is bounded at ~5e-4 km, three orders of
magnitude tighter than the metaheuristic comparison tolerance.

## 5. Rust API

```rust
// crates/vrppd-or-tools/src/lib.rs

use std::time::Duration;
use vrppd_core::{Objective, Problem};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug)]
pub enum OrToolsError {
    UnsupportedObjective(Objective),   // EMPTY
    PythonNotFound,                     // python3 missing on PATH
    OrtoolsImportFailed(String),        // pip install ortools missing
    SolverFailed(String),               // non-zero exit, malformed output, FAILED status
    SolverInternal(String),             // Python raised; error_msg surfaced verbatim
    Infeasible,                         // CP-SAT proved no solution exists
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OrToolsStatus {
    Optimal,    // proven optimal (CP-SAT only)
    Feasible,   // best-known found, not proven
    TimedOut,   // no incumbent within budget
}

#[derive(Clone, Copy, Debug)]
pub struct OrToolsResult {
    pub objective_value: f64,
    pub status: OrToolsStatus,
    pub solve_time_ms: u64,
}

pub fn solve_routing(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError>;

pub fn solve_cp_sat(
    problem: &Problem,
    target: Objective,
    timeout: Duration,
    threads: usize,
) -> Result<OrToolsResult, OrToolsError>;

pub fn solve_routing_default(problem: &Problem, target: Objective)
    -> Result<OrToolsResult, OrToolsError>;
pub fn solve_cp_sat_default(problem: &Problem, target: Objective)
    -> Result<OrToolsResult, OrToolsError>;
```

### Internal flow

Both public functions are thin wrappers over a private
`run_python(request: SolverRequest) -> Result<OrToolsResult, OrToolsError>`
that:

1. Resolves the script path (see §3).
2. Spawns `python3 <script>` with piped stdin/stdout.
3. Maps `io::Error::kind() == NotFound` on spawn → `PythonNotFound`.
4. Serializes the request via `serde_json::to_writer`, closes stdin.
5. Reads stdout fully, parses as `serde_json::Value`, branches on
   the `ok` flag.
6. On `ok: false`, maps `error_kind` to typed variants:
   - `"ortools_import"` → `OrtoolsImportFailed(error_msg)`.
   - `"invalid_request"` → `SolverFailed(error_msg)` (programmer
     error in the Rust caller — should never happen if the wire
     types stay in sync, but caught explicitly).
   - any other → `SolverInternal(error_msg)`.
7. On `ok: true`:
   - `"INFEASIBLE"` → `Err(Infeasible)`.
   - `"FAILED"` → `Err(SolverFailed(stringified_status))`.
   - `"OPTIMAL" | "FEASIBLE" | "TIMED_OUT"` → corresponding
     `OrToolsStatus`, wrapped in `Ok(OrToolsResult)`.
8. Clamps `objective_value` at 0 (defensive guard matching
   `vrppd-milp`).

### Short-circuits

Both public functions guard up-front, before spawning Python:

- `if matches!(target, Objective::Empty) { return
  Err(OrToolsError::UnsupportedObjective(target)); }`
- `if problem.orders.is_empty() || problem.vehicles.is_empty()
  { return Ok(OrToolsResult { objective_value: 0.0, status:
  Optimal, solve_time_ms: 0 }); }`

### Error display

All `OrToolsError` variants implement `Display` + `std::error::Error`,
so the napi shell can wrap them with one-liners like
`format!("OR-Tools Routing: {e}")`, matching how `vrppd-milp` errors
flow through napi.

## 6. napi-bridge + TS adapters

### napi-bridge additions

Two new exported functions in `crates/napi-bridge/src/lib.rs`,
mirroring `solve_milp`:

```rust
#[napi]
pub fn solve_or_tools_routing(
    problem: Problem,
    target: String,
    config: Option<OrToolsConfig>,
) -> Result<OrToolsResultWire>;

#[napi]
pub fn solve_or_tools_cp_sat(
    problem: Problem,
    target: String,
    config: Option<OrToolsConfig>,
) -> Result<OrToolsResultWire>;
```

`OrToolsConfig` carries `{ timeout_ms: Option<f64> }` — same shape
as `MilpConfig`. `OrToolsResultWire` carries `{ value: f64, status:
String, solve_time_ms: f64 }` — same shape as `MilpResult`. Status
strings on the wire: `"OPTIMAL" | "FEASIBLE" | "TIMEDOUT"`.

Both functions invoke `vrppd_or_tools::solve_routing` /
`solve_cp_sat` with `threads = available_parallelism()`. No dual-target
concurrent dispatch — Python subprocess handles its own internal
threading and we want to keep the call site simple. The TS adapter
calls each napi function once per target (DISTANCE, then PRICE),
sequentially.

Add `vrppd-or-tools = { workspace = true }` to napi-bridge's
`Cargo.toml`, and register the crate in the root workspace
`[workspace.dependencies]`.

### TS adapter scaffolding

```
src/algorithms/or-tools-routing/index.ts
src/algorithms/or-tools-cp-sat/index.ts
```

Each is structurally identical to `src/algorithms/milp/index.ts`:

- Implements the `MultiTargetAlgorithm` interface.
- `solve()` calls the napi function twice (DISTANCE, PRICE),
  sequentially.
- `name = 'or-tools-routing'` (resp. `'or-tools-cp-sat'`).
- Warning policy differs per solver to avoid log noise:
  - `or-tools-cp-sat` logs a warning when status is not `OPTIMAL`
    (mirrors MILP — OPTIMAL is the goal).
  - `or-tools-routing` logs a warning only on `TIMEDOUT`. `FEASIBLE`
    is Routing's normal success state; warning on it would fire on
    every call.
- Warning text reuses MILP's shape so R05 logs stay greppable.
- Emits a `EMPTY_SOLUTION` shell for the routes (matches MILP — the
  harness only consumes the scalar objective values for baseline
  algorithms).
- Empty solution for the EMPTY slot (matches MILP).

### Algorithm registry

Register `'or-tools-routing'` and `'or-tools-cp-sat'` in the same
place `'milp-rust'` and `'cea-rust'` are listed (a quick grep at
implementation time will pin this — likely `src/index.ts` based on
the surrounding layout).

### `scripts/run-r05.sh`

Add both algorithms to the `SKIP_LIST` rules the same way
`milp-rust` is currently handled. Initial defaults:

- 10×20, 20×50, 30×100: both run.
- 50×200: `or-tools-cp-sat` skipped (likely OOM territory like
  MILP); `or-tools-routing` runs.
- 100×500: `or-tools-cp-sat` skipped; `or-tools-routing` runs.

The exact thresholds are dialed in after first-run timings — not
hard-coded into the design.

## 7. Tests

### Unit-level (`crates/vrppd-or-tools/src/lib.rs` `#[cfg(test)]`)

Runs without Python installed — exercises the early-return guards:

- `empty_problem_yields_zero` — empty `vehicles` and `orders` short-circuit.
- `empty_objective_unsupported` — `Objective::Empty` rejected for
  both `solve_routing` and `solve_cp_sat`.

### Integration tests (`crates/vrppd-or-tools/tests/`)

Gated behind an env check (`if env::var("VRPPD_TEST_ORTOOLS").is_ok()`
near the top of each test, with an `eprintln!` skip notice
otherwise). CI skips by default; developer runs locally after
`pip install ortools`.

- `routing_n1_matches_bf` — single-vehicle, single-order fixture.
  Routing returns the BF optimum (trivially correct for N=1).
- `cp_sat_n1_matches_bf` — same fixture; assert
  `status == Optimal` and value matches BF.
- `cp_sat_n3_matches_bf` — loads
  `crates/vrppd-bounds/tests/fixtures/two_vehicles_three_orders.json`,
  runs BF for ground truth, runs CP-SAT with 60 s budget.
  Assert `status == Optimal` and
  `|value − bf_optimum| < 1e-3`. Direct analogue of
  `vrppd-milp`'s `warm_start_n3_distance_matches_bf`.
- `routing_n3_within_tolerance` — same fixture, Routing solver.
  Assert `status == Feasible`,
  `value ≥ bf_optimum − 1e-3` (Routing cannot beat the proven optimum;
  any reported value below it indicates a model or scaling bug), and
  `value ≤ bf_optimum × 1.05` (5% tolerance — Routing is
  near-optimal, not exact).
- `cp_sat_status_timeout` — N=10 instance, `timeout = 1ms`.
  Assert returns `Ok` with `TimedOut` or `Feasible`; never errors.
- `python_missing_error` — sets `VRPPD_ORTOOLS_PY` to a
  non-existent path. Assert `Err(SolverFailed)` or
  `Err(PythonNotFound)` (whichever the spawn maps to).

No exhaustive `bf_match.rs`-style grid for Routing — Routing is
near-optimal by design and most cells would produce noise, not
signal.

### TS-side validation

Once both adapters are wired, run the existing parity-smoke pattern
(`scripts/parity-smoke.ts`, generalised if necessary) on a 5_5 class
to confirm the adapter pipes objective values through correctly.

## 8. Build, install, and documentation

`cargo build` works on a fresh checkout without Python installed.
The Python check is runtime-only, surfaced as
`OrToolsError::PythonNotFound` or
`OrToolsError::OrtoolsImportFailed` on first `solve_*` call.

### BENCHMARKS.md addition

A new "OR-Tools setup" subsection:

```text
# OR-Tools baseline (vrppd-or-tools)

The vrppd-or-tools crate shells out to a Python script that uses the
google/or-tools package. Install once:

    pip install -r crates/vrppd-or-tools/python/requirements.txt

Verify the install:

    python3 crates/vrppd-or-tools/python/solver.py --self-test

The crate's solve_routing / solve_cp_sat return a typed error
(OrtoolsImportFailed / PythonNotFound) if the install is missing.
```

`--self-test` is a one-liner inside `solver.py` that imports both
`ortools.constraint_solver` and `ortools.sat.python.cp_model` and
prints the ortools version, so install failures surface cleanly
without needing a problem JSON.

### `requirements.txt`

Pins `ortools>=9.10,<10` (current LTS line as of late 2025). Exact
version is verified against `pip show ortools` at first install.

## 9. Risks and mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| Python subprocess startup dominates short solves at small N | Low | Negligible (~200 ms) against 60 s+ solver budgets in PLAN.md §4.2. |
| `ortools` wheel install fragility (Apple Silicon, Linux) | Medium | Pin to a known wheel-shipping version; document install in BENCHMARKS.md. Fallback `--no-binary :all:` documented but discouraged (slow). |
| Routing finds no feasible solution at low time budgets for N=500 | Medium | 30-min default timeout. `PATH_CHEAPEST_ARC` first-solution heuristic finishes in seconds, so true `TimedOut` is rare. |
| CP-SAT slower than HiGHS on this MILP (defeats the point) | Low-Medium | Validate at N=10..14 first (parity with BF; cross-check with MILP). If CP-SAT loses across the board, demote to "alternative formulation reference" in the thesis. |
| Distance scaling round-off (integer truncation) | Low | 1e6 scale = sub-mm precision. Accumulated error bounded at ~5e-4 km on N=500, three orders of magnitude tighter than the comparison tolerance. |
| Status-enum drift (new OR-Tools status not mapped) | Low | Default arm in the status mapper returns `Failed(stringified_status)`; never panics. |
| Python and Rust diverge on Haversine formula | Low | Cross-check at integration-test time: N=1 fixture's BF distance == OR-Tools cost. Any drift surfaces immediately. |

## 10. Cross-references

- `documents/MILP_adaptation_notes.md` — the adapted MILP both
  solvers encode.
- `crates/vrppd-milp/` — sibling crate this one mirrors in shape.
- `crates/vrppd-bounds/` — LP-relaxation lower bound; tests share the
  `two_vehicles_three_orders.json` fixture.
- `PLAN.md` §3 and §4.2 — the bounds + comparison matrix this crate
  extends.
- `BENCHMARKS.md` — gets the new "OR-Tools setup" subsection.
- `scripts/run-r05.sh` — gets the new algorithm names added to its
  skip-list rules.
