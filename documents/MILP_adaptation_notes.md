# MILP adaptation notes

How the MILP formulation of `Kursinis_darbas.pdf` §2 is adapted to match
the problem the implementation actually solves, and how the lower bounds
in `crates/vrppd-bounds` are anchored against that adapted MILP.

> Cf. `documents/Kursinis_darbas.pdf`, sections 2.1–2.5. The original
> formulation is the "general" model the thesis introduces; this document
> describes the **simplified** variant used by the metaheuristic
> comparison and the bounds analysis.

## Why an adaptation is needed

The original MILP encodes time windows, integer capacities, a per-vehicle
maximum tour length, and a single objective (empty distance). The Rust
implementation that the metaheuristic crates (`vrppd-brute-force`,
`vrppd-psa`, `vrppd-cea`) optimise enforces a strict subset of those
constraints and supports three interchangeable objectives. The lower
bounds in `vrppd-bounds` must therefore be derived from the adapted MILP,
otherwise a "lower bound" computed for the richer problem would
under-bound the simpler one (and produce nonsense RPDs).

## What the implementation actually solves

| Aspect | Original §2 MILP | Implementation |
| --- | --- | --- |
| Vehicle start `S_v` | yes | yes |
| Per-km vehicle price `kaina_km_v` | parameter only (not in objective) | yes — used by PRICE objective |
| Vehicle availability date `data_laisva_v` | constraint 5(a) | **dropped** |
| Vehicle capacity `talpa_v` | integer | **replaced**: real-valued unit capacity, all vehicles `MAX_LOAD = 1.0` |
| Order pickup / delivery locations | yes | yes |
| Order pickup date `data_pakrovimo_o` | strict equality 5(b) | **dropped** |
| Order block count `blokai_o` | integer | **replaced**: encoded as `1 / load_factor`, real-valued |
| Travel-time consistency 5(c) | yes | **dropped** (no `t_iv` variables at all) |
| Max total distance `D_max_viso = 1200` per vehicle | constraint 7 | **dropped** |
| MTZ subtour elimination | constraint 8 | **kept**: needed in the adapted MILP, implicitly enforced by heuristics whose route representation forbids sub-tours by construction |
| Pickup-before-delivery precedence | constraint 4 (via time) | **kept**: enforced via stop-ordering rather than via time variables |
| Objective | minimise empty distance | **three variants**: EMPTY / DISTANCE / PRICE, run as separate single-objective problems |

The three dropped families (date / time-consistency / max-distance) are
the parts that PLAN.md flags as out-of-scope for the comparison; see
`documents/CEA_adaptation_notes.md` for the same simplification in the
metaheuristic context.

## Adapted MILP

### 4.1 Sets and parameters

Same as §2.1 / §2.2 of the original, **except**:

- `data_laisva_v`, `data_pakrovimo_o`, `kaina_o`, `D_max_viso`,
  `D_max_dienos`, `T_keliones`, and `talpa_v` (integer) **are removed**.
- `talpa_v` is replaced by a constant `MAX_LOAD = 1`.
- `blokai_o` is replaced by a continuous parameter `weight_o = 1 / load_factor_o ∈ ℝ_{>0}`.

### 4.2 Decision variables

- `y_ov ∈ {0,1}`: order `o` is assigned to vehicle `v`.
- `x_ijv ∈ {0,1}`: vehicle `v` travels directly from node `i ∈ L` to
  node `j ∈ L` (`i ≠ j`).
- `q_iv ∈ ℝ_{≥0}`: load of vehicle `v` upon arrival at node `i ∈ L`.
  `q_{S_v,v} = 0`.
- `u_iv ∈ ℝ_{≥0}`: position of node `i ∈ N` in vehicle `v`'s tour
  (MTZ ordering variable; only needed for the subtour-elimination
  constraints).

The time variables `t_iv` are removed.

### 4.3 Objective variants

Let `E_v = atst(S_v, j) · x_{S_v,j,v}` for the leg leaving the start
location, and let `Loaded_v = Σ_{o ∈ O} y_{ov} · atstumas_o` be the
distance the vehicle carries cargo for orders assigned to it.

- **DISTANCE** (total kilometres):
  `Z_dist = Σ_{v∈V} Σ_{i∈L} Σ_{j∈L, i≠j} x_{ijv} · atst(i,j)`
- **EMPTY** (the original §2 objective):
  `Z_empty = Z_dist − Σ_{v∈V} Σ_{o∈O} y_{ov} · atstumas_o`
  (total distance minus the loaded portion). **Defined here for
  completeness, but not exposed by the LP-LB or MILP solvers** — see
  [§4.5 below](#45-why-z_empty--implementation-empty) for why this
  formula diverges from the implementation's load-aware empty distance.
- **PRICE** (heterogeneous-fleet money cost):
  `Z_price = Σ_{v∈V} kaina_km_v · Σ_{i∈L} Σ_{j∈L, i≠j} x_{ijv} · atst(i,j)`

Each run of the bounds solver picks one of the three.

### 4.4 Constraints

Only the constraints with no time / max-distance dependency carry over.
Numbering follows §2.5 of the original.

1. **Order assignment** (§2.5.1, **strengthened**):
   `Σ_{v∈V} y_{ov} = 1     ∀ o ∈ O`
   The original `≤ 1` allowed un-served orders. Our brute-force solver
   only records full-assignment solutions (it returns the default
   solution if no assignment serving every order exists), and the
   metaheuristics likewise treat full coverage as the goal. Tightening
   `≤` to `=` makes the LP optimum a lower bound on what the
   implementation actually computes — without this strengthening the LP
   would trivially pick `y = 0`, `x = 0` and report a useless `0` for
   every objective.
2. **Tour starts at vehicle's location** (§2.5.2):
   `Σ_{j∈L} x_{S_v,j,v} ≤ 1` and `Σ_{i∈N} x_{i,S_v,v} = 0     ∀ v ∈ V`
3. **Order servicing** (§2.5.3 — verbatim):
   each order's pickup and delivery nodes are entered and exited by the
   assigned vehicle iff `y_{ov} = 1`.
4. **Pickup-before-delivery** (§2.5.4, **adapted**):
   the original uses time variables. Without them we use the MTZ
   position variables `u`:
   `u_{P_o,v} + 1 ≤ u_{D_o,v} + |N| · (1 − y_{ov})     ∀ o ∈ O, v ∈ V`
5. **(removed)** §2.5.5 time/date constraints — none.
6. **Capacity** (§2.5.6, adapted to real-valued weights):
    - `q_{S_v,v} = 0     ∀ v ∈ V`
    - per-node net change `Δ_iv` defined exactly as §2.5.6.b.i but with
      `weight_o = 1 / load_factor_o` instead of `blokai_o`.
    - flow conservation 6.b.ii, 6.b.iii **unchanged in shape**.
    - capacity ceiling: `0 ≤ q_{jv} ≤ MAX_LOAD = 1     ∀ v ∈ V, j ∈ N`.
7. **(removed)** §2.5.7 max-total-distance — none.
8. **MTZ subtour elimination** (§2.5.8, verbatim).

The result is a clean MILP whose feasible region matches what the Rust
solvers explore and whose optima coincide with the BF outputs on
`N ≤ 14` instances — verified empirically by the tightness tests in
`crates/vrppd-bounds/tests/bf_tightness.rs`.

### 4.5 Why `Z_empty` ≠ implementation EMPTY

The §2.4 formula `Z_empty = Z_dist − Σ_o (y_{ov} · atstumas_o)`
measures empty distance as *total kilometres minus the sum of each
order's straight-line pickup-to-delivery distance*. The implementation
(`vrppd-brute-force`, `vrppd-psa`, `vrppd-cea`) measures it differently:
it walks each leg of each route and sums the legs where the vehicle's
load on departure is `0`. The two definitions agree only when every
order is picked up and delivered back-to-back, with no interleaving.

#### Concrete divergence

Vehicle starts at `S` and serves two orders with locations chosen so
their loaded portions overlap:

- O1: pickup `A`, delivery `D`
- O2: pickup `B`, delivery `C`

Route: `S → A → B → C → D` (picks up O1 at `A`, picks up O2 at `B`
while still carrying O1, delivers O2 at `C`, delivers O1 at `D`).

| Quantity | Value |
| --- | --- |
| `Z_dist` | `atst(S,A) + atst(A,B) + atst(B,C) + atst(C,D)` |
| Σ direct atstumas | `atst(A,D) + atst(B,C)` |
| §2.4 `Z_empty` | `Z_dist − atst(A,D) − atst(B,C)` |
| Implementation `empty` | `atst(S,A)` (only `S→A` is empty) |

These are functions of different things. The §2.4 formula subtracts the
*direct* `A→D` distance even though the vehicle never travelled that
leg, and only counts O2's loaded portion as `B→C` even though the
vehicle is *also* carrying O1 over that segment. The implementation
asks per leg "was the load zero here?". Depending on geometry, §2.4
EMPTY can be larger or smaller than implementation EMPTY for the same
solution.

#### Why this rules out reporting `Z_empty*`

A solver minimising `Z_empty` is not minimising implementation EMPTY.
Likewise, an LP-relaxed `Z_empty` is not a valid lower bound on
implementation EMPTY in either direction. Plugging an MILP optimum of
`Z_empty` into a parity report — or treating it as a quality reference
for the metaheuristics — would be unsound. Hence the API guards
described in §4.6.

#### What a load-aware EMPTY MILP would require

To make the MILP measure the same quantity the implementation does,
the model would need:

- per-leg empty-flag variables `e_{ijv} ∈ {0,1}` linked to the load
  state: `e_{ijv} = 1` iff `q_{iv} = 0` and `x_{ijv} = 1`. The
  conjunction is non-linear and requires Big-M linearisation
  (`e_{ijv} ≤ 1 − q_{iv} / M_q`, `e_{ijv} ≤ x_{ijv}`,
  `e_{ijv} ≥ x_{ijv} − q_{iv} / M_q`, etc.);
- a replacement objective `Σ x_{ijv} · e_{ijv} · atst(i,j)`, also
  Big-M-linearised through an auxiliary `z_{ijv} = x_{ijv} · e_{ijv}`.

The result is a substantially larger model with looser LP relaxation
and slower branch-and-bound. Out of scope for this thesis; recorded as
a future-work direction (PLAN.md §10).

### 4.6 Behaviour at the API boundary

The two consumers of the §2.4 formula handle the EMPTY rejection
asymmetrically:

- **`vrppd-milp::solve_milp`** returns
  `Err(MilpError::UnsupportedObjective(Objective::Empty))` — surfaced
  through napi as the error string `MILP for objective Empty is not
  supported (see docs)`. Calling it on EMPTY is a hard refuse.
- **`vrppd-bounds::lower_bound_lp`** returns the trivial `0` for EMPTY
  rather than erroring — pass-through behaviour preserved so callers
  that don't know about the divergence get a deterministic answer
  rather than a panic. The benchmark harness now skips EMPTY for
  `lb-lp` via `supportedTargets`, so the `0` is no longer recorded.

Both behaviours are stable. Consumers building new adapters should
declare EMPTY as unsupported and avoid the call entirely.

## Lower bounds derived from the adapted MILP

### `LB_direct` — direct-sum bound

`LB_direct(EMPTY)   = 0` — there exist solutions where every leg is
loaded (e.g. when a single vehicle picks up and delivers the same order
back-to-back), so the trivial bound on empty distance is zero.
`LB_direct(DISTANCE) = Σ_{o ∈ O} atstumas_o` — every feasible solution
must traverse the loaded leg of every served order; we lose only the
empty legs (`empty_distance ≥ 0`) and the start-to-first-pickup leg
(also `≥ 0`).
`LB_direct(PRICE)   = (min_{v ∈ V} kaina_km_v) · LB_direct(DISTANCE)` —
each kilometre of loaded distance must be paid for by *some* vehicle,
and the cheapest-priced vehicle yields the loosest valid bound.

This bound is computable in `O(N)` from the problem data and works at
**any** scale. Its tightness against the BF optimum on the small
fixtures is reported by the tests so the looseness can be quoted in the
thesis.

### `LB_LP` — LP relaxation

Take the MILP above, relax `y_{ov} ∈ {0,1} → [0,1]` and
`x_{ijv} ∈ {0,1} → [0,1]`, keep `q_iv` and `u_iv` continuous. The LP
optimum is a valid lower bound on the MILP optimum (the LP feasible
region contains the MILP feasible region).

Implemented in `crates/vrppd-bounds/src/lp.rs` via `good_lp` with the
`microlp` backend (pure-Rust LP solver — no external install required).
The same constraint set is used for all three objectives; only the
objective expression differs:

- DISTANCE: `Σ_{v} Σ_{i,j∈L_v, i≠j} x_{ijv} · atst(i,j)`
- PRICE:    `Σ_{v} kaina_km_v · Σ_{i,j∈L_v, i≠j} x_{ijv} · atst(i,j)`
- EMPTY:    short-circuited to `0` at the API layer — see §4.5 and
  §4.6. The formula `DISTANCE − Σ_{v} Σ_{o} y_{ov} · atstumas_o` is
  computable but does not measure the implementation's load-aware
  empty distance, so the LP-LB consumer is not exposed to it.

Big-M values: `M_q = 2` (since `MAX_LOAD = 1`), `M_u = 2N`
(MTZ position upper bound). For each vehicle `v` we restrict the model
to the node set `L_v = {S_v} ∪ N` (its own start plus all service
nodes); other vehicles' starts are not flowed through `v`'s arcs at
all, which keeps the LP tight without redundant zero-flow variables.

## Exact MILP optimum

`crates/vrppd-milp` solves the same constraint set with full integrality
(`y_ov, x_ijv ∈ {0,1}`) via the bundled HiGHS branch-and-cut solver,
exposed as

```rust
solve_milp(problem, target, timeout) -> Result<MilpResult, MilpError>
```

The result distinguishes `MilpStatus::Optimal` (HiGHS proved the
returned `objective_value` is optimal) from `MilpStatus::TimedOut`
(wall-clock budget elapsed; `objective_value` is the best primal
incumbent found). PLAN.md §3.3 specifies a 30-minute timeout per
instance, exposed as `vrppd_milp::DEFAULT_TIMEOUT`.

`Objective::Empty` is **not** supported — `solve_milp` returns
`MilpError::UnsupportedObjective(Objective::Empty)`. The reason is that the §2.4
formula and the implementation's load-aware empty distance measure
different quantities (see §4.5 for the derivation and a worked
example), so a MILP optimum on `Z_empty` would not be a valid
reference for the implementation's EMPTY metric. `DISTANCE` and
`PRICE` are supported and verified to coincide with brute-force
optima on `N ≤ 3` fixtures (see `crates/vrppd-milp/tests/bf_match.rs`).
LP-LB and MILP behave asymmetrically on EMPTY (silent `0` vs. hard
error); see §4.6.

## Empirical validation (PLAN.md §3.4)

The bound-validation sweep at `crates/vrppd-validation/src/bin/bound_sweep.rs`
runs BF + LP-LB + exact MILP on every instance with `N ≤ MAX_N` and
emits per-row soundness, LP tightness, and MILP/BF agreement. PLAN.md
§3.4 requires this to be run on the small bank for the bounds chapter.

Latest run: small bank (490 instances, `MAX_N = 7`,
`milp-timeout-secs = 60`), 980 rows, ~66 minutes single-threaded
(parallelised in a follow-up — the next sweep at the same scope drops
to ~15–20 min on 6 cores). Output: `results/bound_sweep_n7.csv`
(gitignored — copy out for thesis).

| Objective | Rows | Sound | MILP=BF | MILP timeouts | LP/BF mean | min | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DISTANCE | 490 | 490/490 (100%) | 484/490 (98.78%) | 14 | 0.699 | 0.153 | 1.000 |
| PRICE    | 490 | 490/490 (100%) | 485/490 (98.98%) |  9 | 0.695 | 0.123 | 1.000 |

Findings:

1. **LP-LB is sound on every row.** Across both objectives, every
   recorded `LP_LB ≤ BF_opt + 1e-6`. The relaxation in §4.5 / `LB_LP`
   is empirically correct on the full small bank.
2. **MILP correctness modulo timeouts.** Every MILP/BF disagreement is
   a 60 s wall-clock timeout — HiGHS returned its best primal incumbent
   without proving optimality. `MILP timeouts > mismatches` on both
   objectives (8 DISTANCE and 4 PRICE timed-out runs returned the BF
   optimum but couldn't prove it within budget). PLAN.md §3.3 specifies
   a 30 min ceiling that closes the remaining gap; no row indicates a
   model bug.
3. **LP tightness ≈ 0.70.** Mean `LP_LB / BF_opt` is 0.699 (DISTANCE)
   and 0.695 (PRICE) across `N ≤ 7`, with a left tail to ~0.12. This
   is the empirical input PLAN.md §6 was waiting for: when reporting
   metaheuristic RPD vs LP-LB at scales beyond BF tractability the
   reported figure is biased high by ≥ 30%, so the "RPD vs
   best-known-from-any-algorithm" complementary metric in §6 becomes
   mandatory for a fair Phase 4 quality reading.

## Cross-references

- `documents/Kursinis_darbas.pdf` §2 — the original general formulation.
- `documents/CEA_adaptation_notes.md` — the same simplification in the
  metaheuristic context.
- `crates/vrppd-bounds/` — the bound implementations.
- `crates/vrppd-milp/` — the exact MILP solver (HiGHS).
- `PLAN.md` §3 — the bounds + MILP roadmap.
