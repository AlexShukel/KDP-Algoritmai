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
  (total distance minus the loaded portion).
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
- EMPTY:    DISTANCE − `Σ_{v} Σ_{o} y_{ov} · atstumas_o`
- PRICE:    `Σ_{v} kaina_km_v · Σ_{i,j∈L_v, i≠j} x_{ijv} · atst(i,j)`

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

`Objective::Empty` is **not** supported by the MILP for the same reason
as `LB_LP`: the §2.4 formula models a quantity that's an *upper* bound
on the implementation's load-aware empty distance, and the two values
diverge whenever pickups and deliveries interleave. `DISTANCE` and
`PRICE` are supported and verified to coincide with brute-force
optima on `N ≤ 3` fixtures (see `crates/vrppd-milp/tests/bf_match.rs`).

## Cross-references

- `documents/Kursinis_darbas.pdf` §2 — the original general formulation.
- `documents/CEA_adaptation_notes.md` — the same simplification in the
  metaheuristic context.
- `crates/vrppd-bounds/` — the bound implementations.
- `crates/vrppd-milp/` — the exact MILP solver (HiGHS).
- `PLAN.md` §3 — the bounds + MILP roadmap.
