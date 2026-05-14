# vrppd-or-tools — OR-Tools baseline (Routing Solver + CP-SAT)

> Companion document for the `vrppd-or-tools` crate. Read alongside
> `docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md` (the
> design doc), the Rust glue in `src/lib.rs` + `src/wire.rs`, and the
> Python driver in `python/solver.py`.

## 1. What this crate is

An OR-Tools baseline for the project's specific VRPPD variant. Two
solvers are exposed, one shared Python driver, one Rust wrapper that
shells out to it:

| Entry point | Backend | Use case |
|---|---|---|
| `solve_routing(problem, target, timeout, threads)` | `ortools.constraint_solver` (Routing Solver) — local-search metaheuristic | Large-N near-optimal reference. Returns FEASIBLE almost always; rarely proves OPTIMAL. |
| `solve_cp_sat(problem, target, timeout, threads)` | `ortools.sat.python.cp_model` (CP-SAT) — branch-and-cut over integer programming | Medium-N exact baseline. Proves OPTIMAL where the time budget allows. |

Both go through `dispatch` in `lib.rs`, which serialises the problem to
JSON, spawns `python3 solver.py`, and parses the JSON response.
`solve_*_default(problem, target)` convenience wrappers use
`DEFAULT_TIMEOUT` (30 minutes) and `available_parallelism()` threads.

The crate exists because:

- For the large-N cells of the R05 cut matrix (50_200, 100_500), the
  `vrppd-milp` HiGHS solver OOMs or times out. OR-Tools' Routing Solver
  scales much further; CP-SAT scales further than HiGHS as well.
- It gives the thesis a published, well-known reference point so we can
  cite "vs. OR-Tools" alongside "vs. MILP / LP-LB / BF."

## 2. Why a Python subprocess

OR-Tools' Rust bindings are immature; the supported surface is the
Python and C++ APIs. Rather than depend on a community wrapper, the
crate shells out to a single self-contained Python driver:

- The OS-level boundary keeps the Rust target buildable on any machine
  with `cargo build` — no `cmake -DBUILD_PYTHON=OFF` dance, no C++
  linkage to the OR-Tools shared object.
- The crate's Rust dependencies stay tiny (`serde`, `serde_json`, plus
  `vrppd-core`).
- The driver is run once per problem; latency is dominated by the
  solve, not the subprocess overhead.

Trade-off: the Python install must be present. The wrapper resolves
`python3` in this order so the developer doesn't need to
`source .venv/bin/activate` before every `cargo test` / `pnpm start`:

1. `$VRPPD_PYTHON3` env override.
2. `<workspace>/.venv/bin/python3` (the project's checked-in venv path).
3. `python3` on `PATH`.

Missing interpreter → `OrToolsError::PythonNotFound`. Missing
`ortools` package → `OrToolsError::OrtoolsImportFailed(msg)` (the
driver imports both `cp_model` and `pywrapcp` up-front and reports the
exception text).

The Python script lives at `crates/vrppd-or-tools/python/solver.py`; it
can also be invoked manually with `python3 solver.py --self-test` to
verify the install.

## 3. Wire format (`wire.rs` ⇄ `solver.py`)

Single JSON request/response over stdin/stdout. The Rust side
(`SolverRequest`, `WireProblem`, `WireVehicle`, `WireOrder`) and the
Python side (`build_geometry`) keep field names identical so the contract
is one struct on each end.

```jsonc
// Request (written to Python's stdin)
{
  "solver":     "routing" | "cp_sat",
  "objective":  "DISTANCE" | "PRICE",
  "timeout_ms": 1800000,
  "threads":    8,
  "problem": {
    "vehicles": [{ "id", "start_lat", "start_lon", "price_km" }, ...],
    "orders":   [{ "id", "pickup_lat", "pickup_lon",
                    "delivery_lat", "delivery_lon", "load_factor" }, ...]
  }
}

// Response (written to Python's stdout)
{
  "ok": true,
  "objective_value":    1234.56,
  "status":             "OPTIMAL" | "FEASIBLE" | "TIMED_OUT" |
                        "INFEASIBLE" | "FAILED",
  "solver_runtime_ms":  120345
}
// or
{
  "ok": false,
  "error_kind": "ortools_import" | "invalid_request" | <other>,
  "error_msg":  "<exception text>"
}
```

Status mapping (`lib.rs::dispatch`):

| Wire | Crate |
|---|---|
| `"OPTIMAL"` | `OrToolsStatus::Optimal` |
| `"FEASIBLE"` | `OrToolsStatus::Feasible` |
| `"TIMED_OUT"` | `OrToolsStatus::TimedOut` |
| `"INFEASIBLE"` | `Err(OrToolsError::Infeasible)` |
| `"FAILED"` | `Err(OrToolsError::SolverFailed(...))` |
| `ok=false` + `error_kind="ortools_import"` | `Err(OrToolsError::OrtoolsImportFailed(msg))` |
| `ok=false` + `error_kind="invalid_request"` | `Err(OrToolsError::SolverFailed(msg))` |
| `ok=false` + other | `Err(OrToolsError::SolverInternal(msg))` |

`solve_*` returns `OrToolsResult { objective_value, status,
solve_time_ms }`. `solve_time_ms` is taken from `solver_runtime_ms` in
the response (Python measures around the actual solve call), falling
back to the Rust-side elapsed time if the field is absent.

## 4. Objective coverage

| Objective | Supported | Why / why not |
|---|---|---|
| **Distance** | ✅ | Distance term carried directly as the arc weight. |
| **Price** | ✅ | Per-vehicle `price_km` enters as a per-vehicle arc-cost scaling. |
| **Empty** | ❌ → `OrToolsError::UnsupportedObjective` | Same caveat as `vrppd-milp` / `vrppd-bounds::lp`: the §2.4 formula `Z_empty = total − Σ y · atstumas_o` is an *upper* bound on the implementation's load-aware empty distance. Until a load-aware EMPTY formulation lands, callers asking for EMPTY get an explicit error (guarded in `lib.rs::dispatch`). |

Empty problems (no orders or no vehicles) short-circuit to
`Ok(0.0, Optimal, 0)` without spawning Python (`lib.rs:105`).

## 5. Distance scaling

OR-Tools' Routing Solver works in integers; CP-SAT requires integer
coefficients. Both paths share `DIST_SCALE = 1_000_000` (sub-millimetre
precision on lat/lon-derived kilometres):

```
arc_cost_int = round(haversine_km(i, j) · price_km_v · DIST_SCALE)
objective_km = solver.ObjectiveValue() / DIST_SCALE
```

The scale gives ≥ 6 significant decimal digits — plenty for the
fixtures (which span tens to thousands of km) and never overflows i64
for any plausible instance size.

## 6. Routing Solver (`solver.py::solve_routing`)

### 6.1 Node layout

Identical to `vrppd-milp`'s `NodeIndex` so the two solvers can be
compared apples-to-apples:

```
nodes 0..V                       → vehicle starts
nodes V..V+N                     → order pickups
nodes V+N..V+2N                  → order deliveries
```

Every vehicle ends at its own start node. The closing leg cost is forced
to 0 by the arc-cost callback (matches the MILP's "free
return-to-start" rule).

### 6.2 Algorithm

```
1.  manager = RoutingIndexManager(num_nodes, V, starts, ends)
2.  routing = RoutingModel(manager)
3.  for v in 0..V:
       transit_cb[v]  = λ(i, j) ↦ 0 if j ∈ starts
                                  else round(dist(i,j) · price_km_v · DIST_SCALE)
       routing.SetArcCostEvaluatorOfVehicle(transit_cb[v], v)
4.  Order dimension (unit transit) → enforces precedence by sequence index.
5.  Capacity dimension (demand = +1/load_factor at pickup, −1/load_factor at delivery,
       scaled by DIST_SCALE; capacity = DIST_SCALE per vehicle = MAX_LOAD = 1.0).
6.  for each order o:
       AddPickupAndDelivery(pickup_o, delivery_o)
       VehicleVar(pickup_o) == VehicleVar(delivery_o)        # same-vehicle
       order_dim[pickup_o]  <= order_dim[delivery_o]         # precedence
7.  search.first_solution_strategy = $OR_TOOLS_FIRST_SOLUTION (default: PARALLEL_CHEAPEST_INSERTION)
8.  search.local_search_metaheuristic = GUIDED_LOCAL_SEARCH
9.  search.time_limit.seconds = ceil(timeout_ms / 1000), min 1
10. solution = routing.SolveWithParameters(search)
11. status = OPTIMAL if routing.status()==7 else FEASIBLE
12. value  = solution.ObjectiveValue() / DIST_SCALE
```

Notes:

- **First-solution strategy is env-tunable** via
  `OR_TOOLS_FIRST_SOLUTION`. Common values:
  `PARALLEL_CHEAPEST_INSERTION` (default), `PATH_CHEAPEST_ARC`,
  `LOCAL_CHEAPEST_INSERTION`, `SAVINGS`, `CHRISTOFIDES`. Lets a sweep
  change the seed heuristic without rebuilding.
- **No-solution branch** (`solution is None`): OR-Tools 9.x's
  `routing.status()` returns plain ints. `4` = `ROUTING_FAIL_TIMEOUT` is
  reported as `TIMED_OUT`; anything else as `FAILED`. The integer
  comparison is deliberate — `routing_enums_pb2.ROUTING_FAIL_TIMEOUT`
  doesn't exist as a named attribute in 9.15.
- **Threads** (`threads` field) is accepted on the wire but **not**
  forwarded to the Routing Solver — the metaheuristic isn't
  multi-threaded in OR-Tools 9.x. Pass any value; it's ignored on this
  path.

### 6.3 What kind of result to expect

Routing Solver is local-search-with-restarts, so it almost never proves
OPTIMAL — it reports `FEASIBLE` and the user is responsible for treating
the value as an upper bound on the true optimum. The integration test
`routing_n3_within_tolerance` accepts a 5% slack vs. brute-force on the
2v3o fixture; in practice the gap is much smaller.

## 7. CP-SAT (`solver.py::solve_cp_sat`)

### 7.1 Model

CP-SAT solves the same MILP as `vrppd-milp` and `vrppd-bounds::lp`,
re-encoded into CP-SAT's `BoolVar` + `IntVar` vocabulary:

| Variable | CP-SAT type | Role |
|---|---|---|
| `y_(o,v)` | `BoolVar` | order `o` is served by vehicle `v` |
| `x_(i,j,v)` | `BoolVar` (only for `i ≠ j`, both in `vehicle_nodes(v)`) | arc `i → j` traversed by `v` |
| `q_(i,v)` | `IntVar [0, DIST_SCALE]` (post-arrival load); start node pinned at 0 | scaled load (MAX_LOAD=1.0 → `DIST_SCALE` units) |
| `u_(i,v)` | `IntVar [0, 2N]` | MTZ position label on service nodes |

`vehicle_nodes(v) = {start(v)} ∪ {all pickups} ∪ {all deliveries}` — the
location set `L_v` from the model.

### 7.2 Constraints

Numbered to match the MILP write-ups in `vrppd-milp` and `vrppd-bounds`:

1. **Assignment**: `Σ_v y_(o,v) = 1` for each order.
2. **Tour start at most once**: `Σ_j x_(start_v, j, v) ≤ 1` per vehicle.
3. **Flow conservation** at each `(o, v)`: in/out of pickup_o = in/out
   of delivery_o = `y_(o, v)` (four sums per `(o, v)`).
4. **Pickup-before-delivery (MTZ)**:
   `u_p − u_d + 2N · y_(o, v) ≤ 2N − 1`.
5. **Capacity flow (big-M)** with `M_q = 2 · DIST_SCALE`:
   - At the pickup of `o` traversed by `v`: load grows by
     `DIST_SCALE / load_factor_o`.
   - At the delivery: load drops by the same.
   - Two-sided Big-M linearisation:
     `expr − M_q · x_(i,j,v) ≥ −M_q`,
     `expr + M_q · x_(i,j,v) ≤ M_q`,
     where `expr = q_(j,v) − q_(i,v) ± w · y_(o,v)` (the start node
     contributes no `q_(start,v)` term because it's pinned to 0).
6. **MTZ subtour elimination** on service nodes only (start nodes
   excluded): `u_i − u_j + 2N · x_(i,j,v) ≤ 2N − 1`.

### 7.3 Objective

```
objective = Σ_{(v, i, j)} round(dist(i, j) · price_km_v · DIST_SCALE) · x_(i,j,v)
```

Arcs ending at the vehicle's start contribute 0 (matches the "free
return-to-start" rule).

`obj_coeffs` keeps a parallel `(BoolVar, int_cost)` list during model
build so the script could recompute the objective from a solution if
needed; in practice we just read `solver.ObjectiveValue() / DIST_SCALE`.

### 7.4 Search

```
solver.parameters.num_workers          = max(1, request.threads)
solver.parameters.max_time_in_seconds  = max(0.001, timeout_ms / 1000)
solver.parameters.log_search_progress  = False
```

CP-SAT *is* multi-threaded; `num_workers` actually scales. Status
mapping at the Python boundary:

| CP-SAT status | Wire string |
|---|---|
| `OPTIMAL` | `"OPTIMAL"` |
| `FEASIBLE` | `"FEASIBLE"` |
| `INFEASIBLE` | `"INFEASIBLE"` |
| `MODEL_INVALID` | `"FAILED"` |
| `UNKNOWN` (with time budget set) | `"TIMED_OUT"` |

The `UNKNOWN → TIMED_OUT` mapping is deliberate: with
`max_time_in_seconds` configured, `UNKNOWN` means CP-SAT didn't find any
solution before the budget elapsed. Treating it as a timeout matches
how the surrounding R05 benchmarks aggregate solver behaviour.

### 7.5 What kind of result to expect

CP-SAT is an exact solver. On instance sizes where it fits in the time
budget it proves `OPTIMAL`; above that it reports the best incumbent
(`FEASIBLE`) or `TIMED_OUT`. Empirically CP-SAT scales further than
HiGHS on this model but not as far as the Routing Solver's local search.

## 8. Code map

| File | Purpose |
|---|---|
| `src/lib.rs` | Public surface: `solve_routing`, `solve_cp_sat`, their `_default` wrappers, `OrToolsResult`, `OrToolsStatus`, `OrToolsError`, `DEFAULT_TIMEOUT`. Houses `dispatch` (request build + status mapping), `run_python` (subprocess management), and `python_bin` / `script_path` (interpreter resolution). |
| `src/wire.rs` | `SolverRequest`, `WireProblem`, `WireVehicle`, `WireOrder` (serialise) + `SolverResponse` (deserialise). The contract with Python lives here. |
| `python/solver.py` | The driver. `solve_routing` and `solve_cp_sat` build the OR-Tools models; `build_geometry` is the shared node-layout / distance helper. `main()` reads stdin, dispatches by `solver` field, writes stdout. `--self-test` mode imports both modules and prints the OR-Tools version. |
| `python/requirements.txt` | `ortools` pin for `pip install -r`. |
| `tests/integration.rs` | Gated by `VRPPD_TEST_ORTOOLS=1`; spawns Python and runs both solvers against `vrppd-brute-force` on the 1v1o and 2v3o fixtures. Includes a tight-timeout `cp_sat_status_timeout` test and a `python_missing_error` path that fakes a missing script via `$VRPPD_ORTOOLS_PY`. |

`lib.rs` also has two inline test modules: `type_tests` (error display
strings) and `shortcircuit_tests` (the empty-problem and EMPTY-objective
guards — no Python spawn).

## 9. Reading order for hand-rewrite

1. The design spec
   `docs/superpowers/specs/2026-05-11-or-tools-baseline-design.md` — sets
   the contract.
2. `wire.rs` — three serde structs and a deser struct; takes two
   minutes.
3. `lib.rs::dispatch` and `lib.rs::run_python` — the Rust side is just
   "build JSON, spawn Python, parse JSON." Note the status-string
   match arm and the `script_path` / `python_bin` resolution order.
4. `python/solver.py::build_geometry` — the shared node layout that both
   solvers consume.
5. `python/solver.py::solve_routing` — top-down. The transit-callback
   closure (`make_cb`) is the only non-obvious piece; the rest is
   OR-Tools boilerplate.
6. `python/solver.py::solve_cp_sat` — long but structured. Read the
   variable declarations, then constraints 1–6 in order. Constraint 5
   (capacity flow with Big-M on `IntVar`s) is the densest.
7. `tests/integration.rs` — the contract under `VRPPD_TEST_ORTOOLS=1`.

## 10. Open items for the thesis

For chapter 5.4 *Algorithm: OR-Tools* / chapter 7 *Eksperimentinis
tyrimas*:

- **First-solution sweep**: enumerate `OR_TOOLS_FIRST_SOLUTION` ∈
  `{PARALLEL_CHEAPEST_INSERTION, PATH_CHEAPEST_ARC,
  LOCAL_CHEAPEST_INSERTION, SAVINGS, CHRISTOFIDES}` on a representative
  R05 cell. The default may not be best on the heterogeneous-fleet
  variant.
- **Local-search metaheuristic**: `GUIDED_LOCAL_SEARCH` is the OR-Tools
  default; `TABU_SEARCH` and `SIMULATED_ANNEALING` are also exposed.
  Worth a short comparison since the rest of the thesis runs SA / CEA
  metaheuristics in Rust.
- **CP-SAT scaling ceiling**: at what `N` does CP-SAT stop closing the
  gap within 30 minutes? Compare to HiGHS's ceiling (~30 in
  `vrppd-milp`) and the Routing Solver's ceiling (effectively
  unbounded but never proven optimal).
- **EMPTY support**: same gap as `vrppd-milp` / `vrppd-bounds::lp`.
  Either land per-arc loaded flags (in the CP-SAT path; the Routing
  Solver's dimension API can also express it) or document the gap.
- **Subprocess overhead**: at small `N` the Python startup + JSON
  serialisation dominates the wall-clock cost. Worth a one-paragraph
  measurement so the thesis doesn't mislead about scaling at the small
  end.
- **Determinism**: CP-SAT with `num_workers > 1` is non-deterministic
  by default. If we want reproducible runs in the thesis figures, pin
  `num_workers = 1` or set `random_seed` and document the trade-off.
