# vrppd-bounds — Lower bounds

> Companion document for the `vrppd-bounds` crate. Read alongside
> `documents/MILP_adaptation_notes.md` (the authoritative model derivation)
> and the source.

## 1. What this crate is

Two lower bounds on the optimum of the project's specific VRPPD variant.
Both are valid in the strict sense: for any feasible solution `S`,
`objective(S) ≥ LB`.

| Bound | File | Cost | Tightness | Scale |
|---|---|---|---|---|
| **Direct-sum** | `direct.rs` | `O(N + V)` from problem data | Loose (often very loose for `Empty` and `Price`) | Any. |
| **LP-relaxation** | `lp.rs` | LP solve via `microlp` | Much tighter; depends on the model's relaxation gap | Practical ceiling around `N ≤ 20`. |

For the thesis these bounds serve two roles: (a) they let us measure
quality at scales where `vrppd-brute-force` and `vrppd-milp` can't reach
optimum, by reporting RPD vs LB; (b) the LP-LB tightness ratio (LP/MILP
optimum where both are available) is itself a thesis result.

## 2. Reference: the adapted MILP

The bounds derive from the MILP described in
`documents/MILP_adaptation_notes.md`, which adapts
`documents/Kursinis_darbas.pdf` §2 to what the implementation actually
solves: no time windows, no max-distance ceiling, real-valued unit
capacity. The same model is used by `vrppd-milp` (with full integrality)
to compute exact optima for small instances.

Variables (per vehicle `v ∈ V`, order `o ∈ O`, node `i, j` in v's
location set `L_v`):

| Variable | Domain | Meaning |
|---|---|---|
| `y_ov` | {0,1} (LP: [0,1]) | order `o` is served by vehicle `v` |
| `x_ijv` | {0,1} (LP: [0,1]) | arc `i → j` is traversed by `v` |
| `q_iv` | [0, MAX_LOAD] | load on `v` after visiting node `i` |
| `u_iv` | [0, 2N] | MTZ position label of node `i` on `v` |

Objective (run-time-selected):

- **Distance**: `Σ x_ijv · haversine(i, j)`
- **Price**: `Σ x_ijv · haversine(i, j) · price_km_v`
- **Empty**: not modelled here — see §4.

Constraints (encoded identically in `lp.rs` and `crates/vrppd-milp/src/lib.rs`):

1. Each order assigned to exactly one vehicle: `Σ_v y_ov = 1`.
2. Each vehicle leaves its start node at most once.
3. Flow balance at pickup and delivery: in/out of each = `y_ov`.
4. Pickup-before-delivery: `u_p − u_d + 2N · y_ov ≤ 2N − 1`.
5. Capacity flow: `q_j ∈ q_i + Δ_i ± M_q · (1 − x_ij)` (big-M of 2 is
   enough since `q ∈ [0, 1]` and `Δ ∈ [-1, 1]`).
6. MTZ subtour elimination on service nodes:
   `u_i − u_j + 2N · x_ij ≤ 2N − 1`.

## 3. Direct-sum bound (`direct.rs`)

> Trivial closed-form bound from problem data alone.

```
EMPTY    → 0
DISTANCE → Σ_o haversine(pickup_o, delivery_o)              # "loaded sum"
PRICE    → min_v price_km_v · LB_DISTANCE
```

Why each is a valid lower bound:

- **EMPTY**: every leg can in principle be loaded; 0 is trivially below
  any non-negative empty distance.
- **DISTANCE**: every order's loaded leg pickup→delivery is *unavoidable*
  (you can't deliver without loading). Other legs (start→first-pickup,
  any deadhead) can in principle be zero (vehicle co-located, perfect
  back-to-back chains). So the loaded sum is a strict floor.
- **PRICE**: the cheapest vehicle could in principle absorb every loaded
  kilometre. So `min_v price_km_v · LB_DISTANCE` is a strict floor.

The bound is *intentionally loose* — it doesn't model start-to-first
distance, vehicle assignment, or the loaded-vs-empty interleaving. It
exists to give every objective *some* bound at any scale, including
where the LP-LB doesn't fit.

## 4. LP-relaxation bound (`lp.rs`)

> Same MILP as §2 but with `y, x ∈ [0, 1]` (and `q, u` as continuous box
> variables). Solved by `good_lp` backed by the pure-Rust `microlp`
> simplex backend.

### 4.1 Why pure-Rust LP

- No external solver install — `cargo build` produces a working binary on
  any machine with cmake. (HiGHS is bundled too, but only the
  `vrppd-milp` crate uses it.)
- Reproducible across CI machines without installing a system LP solver.

The trade-off: `microlp` scales worse than HiGHS / CBC / CPLEX. Practical
ceiling for this dense formulation is roughly `N ≤ 20`. Above that, fall
back to direct-sum.

### 4.2 EMPTY caveat (read this once, save the headache)

The original MILP §2.4 expresses `Z_empty = total_distance − Σ y_ov ·
atstumas_o`. That assumes a specific definition of "loaded" (every leg
between pickup and delivery is loaded). The **implementation** in
`vrppd-core::working` instead tracks load segment by segment and counts a
leg as empty iff the vehicle's load was zero just before the leg.

Where pickups and deliveries interleave, the implementation's
*actual* loaded distance is **larger** than the MILP's `Σ atstumas_o`,
which means the MILP's `Z_empty` is an *upper* bound on the
implementation's empty distance — exactly the wrong direction for a
lower bound.

`lower_bound_lp(_, Empty)` therefore short-circuits to `0.0`. To produce
a real `Empty` LB the LP needs per-arc "loaded" flags (a non-trivial
extension); flagged in the open items.

### 4.3 Algorithm

```
input: problem P, target T (Distance | Price; Empty short-circuits to 0)
output: LP optimum z (lower bound), or BoundsError on solver failure

1.  if P empty (no orders or no vehicles): return 0
2.  if T == Empty: return 0                     # see §4.2
3.  build_lp(P) → (vars, constraints, x map, ix helper)
4.  build_objective(P, model, T) → (Expression z, [(var, coef)])
5.  prog = vars.minimise(z).using(microlp).with(constraints...)
6.  sol = prog.solve()                          # microlp simplex
7.  z = Σ coef · sol.value(var)                 # recompute from primal
8.  return max(z, 0.0)                          # numerical-noise clamp
```

Step 7 is intentional — `good_lp` 1.x doesn't expose a uniform
"objective value" accessor, so we recompute from the primal vector. The
`coeffs` parallel list returned by `build_objective` makes this a
constant-time loop.

### 4.4 Node indexing

`NodeIndex` (used identically in `vrppd-milp`) maps logical positions to
flat indices:

```
nodes 0..V                       → vehicle starts
nodes V..V+N                     → order pickups
nodes V+N..V+2N                  → order deliveries
```

`vehicle_nodes(v)` returns `start(v) ∪ all pickups ∪ all deliveries`,
which is the per-vehicle location set `L_v` in the model.

## 5. Code map

| File | Purpose |
|---|---|
| `lib.rs` | Public exports + the two-bounds overview. |
| `direct.rs` | `lower_bound_direct`, `lower_bound_for`, `LowerBounds` struct. ~80 lines incl tests. |
| `lp.rs` | `lower_bound_lp`, `BoundsError`, plus internal `LpModel`, `NodeIndex`, `build_lp`, `build_objective`. ~400 lines incl tests. |
| `tests/bf_tightness.rs` | Direct-sum vs brute-force on small fixtures: confirms the bound never exceeds the optimum. |
| `tests/lp_tightness.rs` | LP-LB vs brute-force on small fixtures: confirms LP-LB ≤ BF optimum and reports the ratio. |

## 6. Reading order for hand-rewrite

1. `documents/MILP_adaptation_notes.md` — read this *before* any source.
   The model is the algorithm; the source just transcribes it.
2. `lib.rs` — surface.
3. `direct.rs` — the easy one. Verify each bound's derivation against §3.
4. `lp.rs` §`NodeIndex` — three small helpers; trace one (vehicle, order)
   pair through `start`, `pickup`, `delivery`.
5. `lp.rs::build_lp` — read the variable declarations first (lines
   136–181), then the constraint blocks (1–6) in order. The MTZ block
   (constraint 6) is the only non-obvious one — note the asymmetry:
   only enforced between *service* nodes, not start nodes.
6. `lp.rs::build_objective` — short. Note the "free return-to-start"
   carve-out: arcs ending at `start(v)` are kept in the model for flow
   balance but contribute 0 to the objective.
7. `lp.rs::lower_bound_lp` — the entry point. Now everything makes sense.
8. Tests — both files are short and pin the bound's expected behaviour.

## 7. Open items for the thesis

For chapter 6 *Apatinės ribos*:

- **LP-LB tightness as a thesis result.** Run the LP and BF on every
  N≤14 instance; report median LP/BF ratio per objective. Expected
  70–90% per PLAN.md §3.2.
- **EMPTY lower bound** (the §4.2 caveat): land a per-arc loaded flag
  formulation OR document the gap and ship the trivial `0.0` for the
  thesis; either is acceptable.
- **Lagrangian relaxation on capacity**: PLAN.md §8 mentioned as future
  work; tighter bounds at the same compute. Out of scope for the 2026
  freeze.
- **Direct-sum bound for empty** is `0.0` regardless of geometry; even a
  cheap heuristic improvement (e.g., `min_v haversine(start_v, any
  pickup)`) would beat it. Mention as future work.
- **`microlp` scaling ceiling**: where exactly does it run out of memory
  / time? Document the breakdown N at which `lower_bound_lp` becomes
  impractical so future engineers know when to swap backends.
