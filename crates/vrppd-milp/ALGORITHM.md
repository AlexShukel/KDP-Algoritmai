# vrppd-milp — Exact MILP solver

> Companion document for the `vrppd-milp` crate. Read alongside
> `documents/MILP_adaptation_notes.md` (the authoritative model
> derivation), `vrppd-bounds/ALGORITHM.md` (LP-relaxation cousin), and the
> single source file `src/lib.rs` (~500 lines).

## 1. What this crate is

An exact mixed-integer LP solver for the project's specific VRPPD
variant. Solves the same model as `vrppd-bounds::lp`, but with the
binaries `y_ov, x_ijv ∈ {0, 1}` enforced (the LP relaxation in
`vrppd-bounds` allows `y, x ∈ [0, 1]`).

Used in the thesis as a **ground-truth baseline**:

- For instances small enough to solve to optimality (`N ≤ ~30` in our
  experience with HiGHS) the MILP optimum is the *exact* optimum and
  serves as the quality reference for p-SA / CEA at those scales.
- For larger instances, the MILP either times out or runs out of memory;
  in that case the result is reported as `MilpStatus::TimedOut` with the
  best primal incumbent found in time.

## 2. Why this crate exists separately from `vrppd-bounds`

Two semantically different things, two different solvers:

| Aspect | `vrppd-bounds::lp` | `vrppd-milp` (this crate) |
|---|---|---|
| Integrality | Relaxed (`y, x ∈ [0, 1]`) | Enforced (`y, x ∈ {0, 1}`) |
| Output meaning | Lower bound | Exact optimum (or time-limited incumbent) |
| Backend | `good_lp` → `microlp` (pure-Rust simplex) | `highs` crate → bundled HiGHS branch-and-cut |
| Practical ceiling | `N ≤ ~20` | `N ≤ ~30` (with a 30-min timeout) |
| Status surface | "did it solve" | `Optimal` vs `TimedOut` distinction |

Splitting them keeps each crate's dependency footprint minimal and lets
the LP relaxation stay pure-Rust (no cmake required for that path).

## 3. Why HiGHS, accessed directly

- HiGHS is MIT-licensed, fast on small VRP instances, and bundle-able
  from source via cmake (no system install on the developer's machine).
- We use the `highs` crate **directly** rather than going through
  `good_lp` because `good_lp` 1.15 doesn't surface the solver's *model
  status* (`Optimal` vs `ReachedTimeLimit` vs `Infeasible`). We need
  that distinction in the result struct so callers can decide whether
  the value is provably optimal or just "best so far."
- The cost of the direct binding is minor: a single `HashMap<key,
  highs::Col>` per variable family during construction, plus a
  hand-built `(Col, coefficient)` list to recompute the objective from
  the primal vector (the binding doesn't expose `getObjectiveValue`).

## 4. Objective coverage

| Objective | Supported | Why / why not |
|---|---|---|
| **Distance** | ✅ | Direct distance term in the objective. Matches BF on small fixtures. |
| **Price** | ✅ | Distance × per-vehicle `price_km` weight. Matches BF. |
| **Empty** | ❌ → `MilpError::UnsupportedObjective` | Same caveat as `vrppd-bounds::lp` — the §2.4 formula `Z_empty = total − Σ y · atstumas_o` is an *upper* bound on the implementation's load-aware empty distance. Solving the MILP for `Z_empty` would not match the brute-force optimum for `Empty`. Until a load-aware EMPTY formulation lands, callers asking for EMPTY get an explicit error. |

This is documented in the module-level `//!` doc on `src/lib.rs` and in
`documents/MILP_adaptation_notes.md` §2.4.

## 5. Algorithm in pseudo-code

```
input: problem P, target T (Distance | Price; Empty errors out), timeout, threads
output: MilpResult { objective_value, status, solve_time_ms } or MilpError

1.  if T == Empty: return MilpError::UnsupportedObjective(Empty)
2.  if P empty: return Ok(0, Optimal, 0)
3.  model, objective_coeffs = build_milp(P, T)
4.  hm = model.optimise(Sense::Minimise)
5.  hm.set_option("time_limit", timeout)
6.  hm.set_option("output_flag", false)         # silence stdout chatter
7.  hm.set_option("threads", max(threads, 1))   # B&B + concurrent simplex
8.  solved = hm.solve()
9.  match solved.status():
       Optimal           → status = Optimal
       ReachedTimeLimit  → status = TimedOut
       Infeasible        → return MilpError::Infeasible
       other             → return MilpError::SolverFailed(other)
10. z = Σ coef · solved.get_solution()[col] over objective_coeffs
11. return Ok(max(z, 0.0), status, elapsed_ms)
```

Step 10 reconstructs the objective from the primal vector — see §3 for
why we do this ourselves.

The `max(z, 0.0)` clamp on step 11 is identical to the LP path's
clamp: numerical noise occasionally pushes the reported objective a hair
below zero on degenerate instances; clamping makes the result safe to
feed into RPD math downstream.

## 6. Model construction (`build_milp`)

The model is built identically to `vrppd-bounds::lp::build_lp` except
that:

- `y_ov` and `x_ijv` are added with `add_integer_column`, not the
  continuous `add_column` (`good_lp::variable().min(0).max(1)`).
- The objective coefficients live on the `x_ijv` columns themselves
  (HiGHS supports per-column costs at insertion time), and a parallel
  `(col, coef)` list is kept for objective reconstruction.

Variable families and constraints are the same as the LP relaxation:

| Family | Domain | Role |
|---|---|---|
| `y_ov` | {0, 1} | order assignment |
| `x_ijv` | {0, 1} | arc traversal |
| `q_iv` | continuous, [0, 1] | post-arrival load |
| `u_iv` | continuous, [0, 2N] | MTZ position |

Constraints (1)–(6) match the LP — see `vrppd-bounds/ALGORITHM.md` §2
for the list. The `NodeIndex` helper is duplicated here so the two
crates don't have to share an internal type.

## 7. Configuration

`solve_milp(problem, target, timeout, threads)`:

- `target`: `Objective::Distance` or `Price`. `Empty` returns
  `UnsupportedObjective`.
- `timeout`: wall-clock cap. Forwarded to HiGHS as the `time_limit`
  option (in seconds).
- `threads`: parallel branch-and-bound node count + concurrent-simplex
  thread count (HiGHS strategy 4). Pass `available_parallelism() / 2`
  when running two instances concurrently to avoid CPU over-subscription.

`solve_milp_default(problem, target)` is the convenience wrapper using
`DEFAULT_TIMEOUT` (30 minutes — matches PLAN.md §3.3) and
`available_parallelism()` threads.

`solve_milp_with_warm_start(problem, target, timeout, threads,
warm_start)` accepts a `ProblemSolution` (e.g. from PSA / CEA) and seeds
HiGHS with it as the initial primal incumbent via `set_solution`. The
decode lives in the private `warm_start` module and emits column values
for `(y_ov, x_ijv, q_iv, u_iv)`. An infeasible warm-start is silently
discarded by HiGHS, so the function behaves identically to `solve_milp`
in that case.

## 8. Result interpretation

`MilpStatus::Optimal` — `objective_value` is the proven optimum to within
HiGHS's numerical tolerances.

`MilpStatus::TimedOut` — `objective_value` is the best primal incumbent
found in the budget. **The dual bound is not surfaced** (the `highs` crate
1.x doesn't wrap `getMipDualBound`). If a gap is needed, pair the result
with `vrppd_bounds::lower_bound_lp` to get an LP lower bound; that's a
valid lower bound on what the MILP's optimum *would* have been.

## 9. Code map

| File | Purpose |
|---|---|
| `src/lib.rs` | Result types, `solve_milp`, `solve_milp_default`, `solve_milp_with_warm_start`, `build_milp`, `NodeIndex`, helpers. ~700 lines incl tests. |
| `src/warm_start.rs` | Decoder turning a `ProblemSolution` into a column-value vector for HiGHS `set_solution`. |
| `tests/bf_match.rs` | Compares the MILP optimum against `vrppd-brute-force` on small fixtures across a `(V, N)` grid. The two should match exactly. |
| `tests/fixtures/` | Checked-in JSON instances per `(V, N)` cell so the test runs in CI without regenerating `problems/`. |

## 10. Reading order for hand-rewrite

1. `documents/MILP_adaptation_notes.md` — the model is the algorithm.
2. `vrppd-bounds/ALGORITHM.md` §2 — recap the variable list and
   constraints; you'll already have read this when porting the LP.
3. `src/lib.rs` module-level `//!` doc — the *why this crate exists*
   reasoning; lifts to thesis chapter 5.3 directly.
4. `MilpError`, `MilpStatus`, `MilpResult`, `DEFAULT_TIMEOUT` — the
   result surface.
5. `solve_milp` — entry point; flow only, the heavy lifting is in
   `build_milp`.
6. `NodeIndex` — three small helpers; trace one (vehicle, order)
   pair through `start`, `pickup`, `delivery`.
7. `build_milp` — read variable declarations first, then constraints
   (1)–(6) in order. Constraint 5 (capacity flow) is the densest; the
   big-M derivation (`M_q = 2`) is in the comment block immediately
   above.
8. `tests/bf_match.rs` — sanity: small fixture, BF result, MILP result.

## 11. Open items for the thesis

For chapter 5.3 *Algorithm: MILP* / chapter 7 *Eksperimentinis tyrimas*:

- **EMPTY support** — same caveat as `vrppd-bounds::lp` §4.2. Either
  land per-arc loaded flags or document the gap.
- **Dual bound surface**: `highs` crate doesn't wrap
  `getMipDualBound`. If we want the gap reported in `MilpStatus::TimedOut`
  results, either patch the crate or compute it from the LP lower
  bound. Cheap; useful for the results table.
- **HiGHS scaling**: at what `N` does HiGHS start hitting the 30-minute
  wall? Report empirically; bound this in the experimental section.
- **Solver-options sweep**: HiGHS exposes presolve, cut generation, and
  branching strategies. We use defaults. A ½-day sweep on the hardest
  small instance would tell us whether tuning is worth it.
- **Memory ceiling**: HiGHS's MIP tree can balloon on large `N`. Note
  the maximum problem size that fits in 16 GB on the Mac Mini.
