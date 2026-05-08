# CEA adaptation notes

How the Coevolutionary Algorithm of Wang & Chen (2013) is mapped onto the
specific VRPPD variant of this thesis. Every section header below cites the
corresponding paper section. The paper PDF lives at
`documents/WC13_coevolutionary_algorithm.pdf`.

> Wang, H.-F., & Chen, Y.-Y. (2013). *A coevolutionary algorithm for the
> flexible delivery and pickup problem with time windows.* International
> Journal of Production Economics, 141(1), 4–13.
> [https://doi.org/10.1016/j.ijpe.2012.04.011](https://doi.org/10.1016/j.ijpe.2012.04.011)

The paper targets **FDPPTW**: a single distribution centre (DC), a single
collection centre (CC), homogeneous fleet, time-window constraints, two
objectives — minimise number of vehicles (NV, primary) and total distance
(TD, secondary). Our thesis problem is a different VRPPD variant:

| Property               | WC13 (FDPPTW)                       | This thesis                                     |
| ---------------------- | ----------------------------------- | ----------------------------------------------- |
| Hubs                   | Single DC + single CC               | None — every vehicle has its own start location |
| Fleet                  | Homogeneous                         | Heterogeneous (per-vehicle `priceKm`)           |
| Cargo flow             | Depot ↔ customer (delivery / pickup separately) | Point-to-point: each order has own pickup `P_o` and delivery `D_o` |
| Time windows           | Interval `[a_j, b_j]` per customer  | Strict `data_pakrovimo_o` per order             |
| Capacity               | Common `q_v`                        | Per-vehicle `talpa_v`, varying by vehicle       |
| Primary objective      | Minimise NV                         | Minimise one of EMPTY / DISTANCE / PRICE — single-objective per run |
| Secondary objective    | Minimise TD                         | Not used (we run multiple single-objective configurations) |

These differences drive every adaptation below. The structural skeleton of
the algorithm — two co-evolving populations, the operator menu, the
roulette-wheel selection — transfers cleanly. The cost expressions and the
constraint checks have to be reworked.

---

## §4.1.1 — CIM (cheapest insertion baseline)

**Paper:** start with each customer in its own route; iteratively try to
splice a single-route customer `k` between adjacent customers `l, m` in
another route; pick the move with maximum cost saving
`(c_{0k} + c_{k,n+1} + c_{lm}) − (c_{lk} + c_{km})`; stop when no further
reduction is possible.

**Adaptation:** we don't actually use raw CIM — only its successor RSCIM. The
cost-saving formula above hard-codes a depot at index `0` and a CC at index
`n+1`; in our problem there is no shared depot. Whenever we *do* need a CIM-
style "trial insertion" cost (e.g. inside FSCIM in §4.2.4), we replace the
WC13 expression with a direct delta on `total_distance` recomputed from the
actual route after the trial — this is more expensive per trial but avoids
having to adapt the closed-form expression to a heterogeneous-fleet,
no-depot setting.

## §4.1.2 — RSCIM (initial population)

**Paper:** generate a random order of customers; the **top k** customers in
that order are the seeds for k separate routes, where
`k = ⌈Total Demand / Average Vehicle Capacity⌉`. Remaining customers are
each placed into a temporary single-customer route, then merged back into
the seeded routes by best cost-saving insertion. Stop when no further
single-customer route can be eliminated.

**Adaptation:**

- **k formula** stays. With our heterogeneous fleet,
  `Average Vehicle Capacity = mean(talpa_v)`. Total demand is the sum of
  `1 / loadFactor_o` over all orders (the same `1 / loadFactor` we already
  use as a per-order load increment in `vrppd-psa`).
- **Seed route bootstrap:** each seed customer's pickup→delivery pair is
  the initial route on the chosen vehicle. Since vehicles have distinct
  start locations, the seed customer is also the choice of *which* vehicle
  initialises that route. We pick vehicles greedily for each seed customer:
  the still-unused vehicle whose start location minimises
  `start_to_pickup` distance. The paper has nothing to say here because all
  routes start at the DC.
- **Trial-insertion cost:** instead of WC13's closed-form, we recompute the
  resulting route's cost via the existing `WorkingRoute::recalculate` and
  diff against the prior cost. The cost we minimise depends on the active
  objective (DISTANCE / EMPTY / PRICE) — same per-target weighting we
  already use in our p-SA RCRS adapter.
- **Stop condition:** "stop when no single-customer route can be merged"
  reduces in our setting to "every order has been inserted into a real
  route" — equivalent because we always have enough vehicles in the fleet
  to absorb every order. (If the pool of vehicles is exhausted before all
  orders are placed, the surplus orders simply remain unassigned, which is
  permitted by the thesis problem definition.)

## §4.2 — Coevolutionary structure

**Paper:** two populations of size `N` each, both seeded with the same `N`
RSCIM-generated solutions. Each generation: `N` parents → `2N` offspring →
select `N` survivors. Population I uses {Reproduction, Recombination,
Selection}; Population II uses {Reproduction, Local Improvement, Crossover,
Selection}. The best individual of Population I is migrated into
Population II at each generation.

**Adaptation:** lifted verbatim. The migration step gives the
intensification population a steady stream of diverse material, which is
exactly what we need: our problem has no NV-minimisation pressure, and
without diversification injection Population II would converge fast on a
local optimum dictated by our chosen objective.

## §4.2.1 — Reproduction (elitism)

**Paper:** copy the parent with the minimum *objective* value into the
first offspring slot, in both populations.

**Adaptation:** "minimum objective value" maps to the active single
objective we picked for the run (one of EMPTY / DISTANCE / PRICE). Lifted
verbatim otherwise.

## §4.2.2 — Recombination (Pop I)

**Paper:** randomly remove between `n/10` and `n/2` customers from their
current routes; re-insert the removed customers via RSCIM, treating the
post-removal routes as fixed seeds.

**Adaptation:**

- The fraction `[1/10, 1/2]` is sampled uniformly per offspring.
- "Treating existing routes as seeds" means we run the same RSCIM trial-
  insertion machinery used for the initial population, but with seed
  routes already non-empty. Cost criterion follows the active objective.
- **Precedence safety:** removing a customer means removing both its
  pickup and its delivery in one step; insertion places the pair back in a
  route at positions `(i, j)` with `i < j` so pickup precedes delivery.
  This is enforced inside our existing `is_capacity_feasible` /
  `recalculate` machinery — no new code path.

## §4.2.3 — Local Improvement (Pop II)

**Paper:** two operators applied to Pop II offspring:

- **Reinsertion Improvement**: customer `k` between `i, j` is moved to a
  position between `l, m`. Cost saving is
  `(c_{ik} + c_{kj} + c_{lm}) − (c_{lk} + c_{km} + c_{ij})`. **Best-move
  strategy**: evaluate every (customer, alternative position) pair, apply
  the single best.
- **Swap Improvement**: customers `k` (between `i, j`) and `h` (between
  `l, m`) exchange positions. Cost saving is the analogous expression.

**Adaptation:**

- Same direct-recompute-and-diff approach as for FSCIM trial insertions.
  We lose WC13's closed-form efficiency but keep the heterogeneous-cost
  semantics correct without adapting the formula.
- "Customer move" generalises to "(pickup, delivery) pair move" — both
  stops travel together. This is the same constraint as in our p-SA Shift
  operator, and it's enforced by the underlying `WorkingSolution`
  validation.
- **Best-move neighbourhood size:** the paper applies a single best-move
  per offspring. We do the same per offspring; with 2N offspring per
  generation this gives `2N` improvements per generation.

## §4.2.4 — Crossover (FSCIM, Pop II only)

**Paper, Algorithm 1:**

```
function Crossover;
begin
  repeat
    Copy Random Route from Parent 1 to the offspring;
    Copy Random Route from Parent 2 to the offspring;
  until (no more inherited routes are feasible);
  All un-routed customers form single customer routes;
  Reduce all single customer routes by FSCIM;
end;
```

A route from a parent is "feasible to inherit" if every order it covers is
not yet present in the partial offspring (no double-coverage). FSCIM is
the same trial-insertion machinery as RSCIM but with the inherited routes
fixed in place as seeds.

**Adaptation:**

- **Vehicle assignment for inherited routes:** in WC13 each route is
  inherited as a list of customers without a distinct vehicle identity
  (homogeneous fleet). Our routes are bound to a specific vehicle. We
  inherit the route under the **same vehicle** as in its parent, and a
  vehicle that is already used by the partial offspring cannot accept a
  second inheritance. This adds a "vehicle availability" check on top of
  the paper's "no double-covered customers" rule.
- **Termination of the inheritance loop:** matches the paper — stop when
  neither parent has any further route satisfying both checks.
- **FSCIM final step:** unchanged in shape; uses our objective-aware cost
  criterion for trial insertion.

## §4.2.5 — Selection (both populations)

**Paper:** rank the 2N offspring by ascending TD; assign fitness
`4N + 1 − rank` so the minimum-TD individual gets fitness `4N` and the
maximum-TD individual gets fitness `2N + 1`. Reproduce N parents for the
next generation: 1 by elitism (best objective), the remaining N − 1 by
roulette-wheel weighted by `fitness(k) / Σ fitness`.

**Adaptation:**

- **Ranking criterion:** WC13 ranks by TD. We rank by the **active
  objective's energy** (EMPTY / DISTANCE / PRICE). The paper's motivation
  for picking TD over the bi-objective NV+TD doesn't apply to us because
  we run only one objective at a time — so picking that objective is the
  natural single-criterion replacement.
- **Tie-breaking:** the paper is silent on equal TD. We resolve by stable
  insertion order (preserves reproducibility for fixed seeds).
- **Fitness-weighted sampling:** standard `WeightedIndex` over the
  fitness array.

## §4.3 — Termination

**Paper:** convergence at `CONV_COUNT = 500` consecutive stagnant
generations *or* 30-minute wall-time cap.

**Adaptation:** lifted verbatim. The wall-time cap will be configurable
via `SaConfig`-style overrides for our experimental harness (per
PLAN.md §4.1, smaller and larger budgets at different scale classes).

## §5.1 — Parameter values

| Parameter        | WC13 default | Our default |
| ---------------- | ------------ | ----------- |
| `SIZE_POP1`      | 50           | 50 (initial; sweep on 7×7) |
| `SIZE_POP2`      | 50           | 50          |
| `CONV_COUNT`     | 500          | 500         |
| Recombination fraction | uniform on `[1/10, 1/2]` | unchanged |
| Mutation         | not used     | not used    |
| Two-class chromosomes | not used | not used    |

The paper showed empirically (Tables 2 & 3) that mutation operators and the
two-class refinement gave no measurable benefit on FDPPTW. We adopt that
finding rather than re-investigate.

---

## What we explicitly skip

- **NV-aware operators.** WC13 has dedicated machinery for shrinking the
  number of routes whenever feasible (the recombination/crossover loop is
  built around customer redistribution that can empty routes). Our
  problem doesn't reward an empty route — every vehicle has its own
  starting position, so an empty route is just an unused vehicle, neither
  worse nor better. We keep the redistribution mechanics but drop any
  bias toward route reduction.
- **DC ↔ CC distance terms** in cost expressions. There is no DC and no
  CC in our problem; every cost reduces to a sum of consecutive
  pairwise distances along a route, plus an initial leg from
  `vehicle.startLocation` to the first pickup.
- **Time-window slack handling.** Our time model is a strict pickup
  *date*, not an interval. We treat the date constraint as a hard
  feasibility check in the same machinery already used by p-SA, and
  surface infeasibility by rejecting the candidate (matches how p-SA's
  `generate_neighbor` returns `None`).

## Cross-references

- Implementation lives in `crates/vrppd-cea/`.
- The shared problem model and Haversine distance live in
  `crates/vrppd-core/`.
- The p-SA crate (`crates/vrppd-psa/`) shares its
  `WorkingSolution` / matrix infrastructure with this crate via
  `vrppd-core`; see `crates/vrppd-core/src/working.rs`.
- Test fixtures and the experimental comparison live alongside the p-SA
  parity benchmark — see `BENCHMARKS.md`.
