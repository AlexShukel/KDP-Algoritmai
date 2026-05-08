# vrppd-cea — Coevolutionary Algorithm

> Companion document for the `vrppd-cea` crate. Read alongside the source
> while you hand-rewrite the algorithm to internalise it. The source comments
> cover the *what* per file; this document covers the *why* and the
> *how-it-fits-together* across files.

## 1. What this crate is

A coevolutionary algorithm (CEA) for the project's specific VRPPD variant:
heterogeneous fleet, point-to-point pickup/delivery orders, strict pickup
precedence, single switchable objective per run (`Empty`, `Distance`,
`Price`).

Two populations evolve in parallel:

- **Population I — diversification.** Reproduction (elitism) + Recombination
  produce `2N` offspring; `N` survive by roulette-wheel selection.
- **Population II — intensification.** Reproduction (elitism) + the migrated
  best of Pop I + a mix of Local Improvement and Crossover (FSCIM) produce
  `2N` offspring; `N` survive by roulette-wheel selection.

Termination is by *non-improvement count* (`conv_count` consecutive
generations without a global-best improvement) plus an optional wall-time
cap.

## 2. Reference paper [WC13]

> Wang, H.-F., Chen, Y.-Y. *A coevolutionary algorithm for the flexible
> delivery and pickup problem with time windows.* International Journal of
> Production Economics **141** (2013).

The crate's structure follows [WC13] §4 directly:

| Component | Source | This crate |
|---|---|---|
| Two-population framework with migration | §4.1, §4.3 | `coevolve.rs` (top-level loop + `evolve_pop1`, `evolve_pop2`) |
| RSCIM initial-solution heuristic | §4.1.2 | `rscim.rs` |
| Reproduction (elitism) | §4.2.1 | `reproduction.rs` |
| Recombination (remove + RSCIM-reinsert) | §4.2.2 | `recombination.rs` |
| Local Improvement (Reinsertion / Swap) | §4.2.3 | `local_improvement.rs` |
| Crossover via FSCIM | §4.2.4 | `crossover.rs` |
| Rank-based fitness + roulette wheel | §4.2.5 | `fitness.rs` |
| Convergence by non-improvement | §4.3 | `coevolve.rs` (`stagnant >= conv_count`) |

Key adaptations vs. [WC13] (notes for thesis chapter 5.2):

1. **Single objective per run** (the paper uses NV-first / TD-second; we
   remove NV because every order must be served and run three independent
   single-objective optimisations for Pareto comparison).
2. **Heterogeneous fleet**: each route is bound to a specific vehicle with
   a per-vehicle `price_km`. Inheritance during Crossover must respect
   vehicle uniqueness, not just order coverage — see `crossover.rs`'s
   `try_inherit`.
3. **Point-to-point orders** (no depot): the paper's depot-anchored cost
   recurrence isn't applicable. Trial-insertion costs are computed by
   *recompute-and-diff* on the live route via
   `WorkingRoute::recalculate(...)`, which is `O(route_len)` per trial.
4. **No time windows**: precedence is the only temporal constraint;
   `WorkingSolution::is_valid` enforces it.
5. **Closed-form local-improvement cost**: the paper uses Osman (1993)
   cost-saving expressions; we use direct recompute-and-diff because
   the heterogeneous-fleet `Price` mode breaks the Osman closed form.

> The source paper PDF is **not** in `documents/papers/` yet — drop it
> there once available; cross-references in this document point to its
> sections by number. `documents/CEA_adaptation_notes.md` is the
> authoritative adaptation map and is kept up-to-date with code changes.

## 3. Algorithm in pseudo-code

### 3.1 Top-level loop (`coevolve::solve_cea_seeded`)

```
input: problem P, target T (Empty/Distance/Price), config C, seed s
output: solved.solution + history + total generations

1.  matrices = build OrderMatrix and VehicleStartMatrix
2.  pop1 = N RSCIM individuals (one per call to generate_rscim)
3.  pop2 = clone(pop1)                            # both start identical
4.  best = best_individual(pop1, pop2, T)
5.  stagnant = 0
6.  while stagnant < C.conv_count:
7.      if wall-time cap exceeded: break
8.      pop1 = evolve_pop1(pop1, ..., T, C)
9.      pop2 = evolve_pop2(pop2, pop1, ..., T, C) # uses pop1's best for migration
10.     candidate = best_individual(pop1, pop2, T)
11.     if E(candidate) + ε < E(best):
12.         best = candidate
13.         stagnant = 0
14.         history.push(time, gen, metrics)
15.     else:
16.         stagnant += 1
17. return best, history, generation_count
```

The `+ ε` guard on line 11 (`1e-12` in the code) suppresses spurious
improvements from floating-point noise on plateaus.

### 3.2 Pop I evolution (`evolve_pop1`)

```
1.  offspring = []
2.  push reproduce_elite(pop)                     # elitism
3.  fitness = rank-based fitness vector of pop
4.  while len(offspring) < 2N:
5.      parent = roulette_select(fitness, 1)
6.      child  = recombine(parent, fraction in [low, high])
7.      offspring.append(child)
8.  return survive_n(offspring, N)
```

### 3.3 Pop II evolution (`evolve_pop2`)

```
1.  offspring = []
2.  push reproduce_elite(pop2)                    # Pop II elitism
3.  push reproduce_elite(pop1)                    # ← migration from Pop I
4.  fitness = rank-based fitness vector of pop2
5.  while len(offspring) < 2N:
6.      r ~ U(0, 1)
7.      if r < p_crossover and |pop2| ≥ 2:
8.          (i, j) = roulette_select(fitness, 2)
9.          child = crossover(pop2[i], pop2[j])
10.     else:
11.         parent = roulette_select(fitness, 1)
12.         child  = clone(parent); local_improve(child, p_reinsertion)
13.     offspring.append(child)
14. return survive_n(offspring, N)
```

### 3.4 Survival (`survive_n`)

```
input: offspring (size ≤ 2N), N, target T
output: Population of size N

1.  if |offspring| ≤ N: return offspring as Population
2.  elite_idx = best by T
3.  fitness = rank-based fitness (over all offspring)
4.  masked_fitness = fitness with masked_fitness[elite_idx] = 0
5.  picks = roulette_select(masked_fitness, N − 1)
6.  return Population([elite] ++ picks)
```

The mask in step 4 prevents the elite from being drawn twice; it's
spliced back unconditionally afterwards.

## 4. Operators

### 4.1 RSCIM (`rscim.rs`)

> *Random Seeds Cheapest Insertion Method.* Build a feasible solution from
> scratch.

```
1.  perm = random permutation of order indices
2.  k = ⌈total_demand / mean_capacity⌉, clamped to [1, min(V, N)]
3.  Place the first k orders as "seed routes": each in the unused vehicle
    with the shortest start-to-pickup leg. If the seed alone exceeds
    capacity, roll back and treat as a regular insertion.
4.  For each remaining order, find the cheapest (vehicle, pickup_pos,
    delivery_pos) triple by recompute-and-diff under the active objective:
       Distance: Δ_total_distance
       Empty   : Δ_empty_distance + 0.4 × dist(start, pickup)
       Price   : Δ_total_distance × vehicle.price_km
    Insert at the winner.
```

Cost: `O(N · V · L²)` where `L` is the typical route length. Fine for the
scales we run (largest in the cut matrix is N=200).

The same `insert_cheapest` helper is shared with `recombination.rs` and
`crossover.rs`'s FSCIM step — reading it once buys you all three.

### 4.2 Reproduction (`reproduction.rs`)

A trivial elitism step: clone the best individual under the active
objective. Pop I and Pop II both call this every generation. Empty
populations return `None`.

### 4.3 Recombination (`recombination.rs`) — Pop I

> *Remove–insert.* Tear out a fraction of orders, then insert each cheapest
> against the trimmed solution.

```
1.  child = clone(parent)
2.  routed = list of currently-routed order indices
3.  frac = U(low, high)                           # default [0.1, 0.5]
4.  k = clamp(round(frac · |routed|), 1, |routed|)
5.  remove a uniform-random k-subset of routed orders
6.  recompute totals on the trimmed child
7.  for each removed order: insert_cheapest(child, ...)
8.  recompute totals; return child
```

Pickup-precedence is preserved by construction (each remove/insert pair is
applied as a unit).

### 4.4 Local Improvement (`local_improvement.rs`) — Pop II

Picks one of two best-move operators uniformly by `p_reinsertion`:

- **Reinsertion best-move**: enumerate every *currently-routed* order ×
  every alternative `(vehicle, pickup_pos, delivery_pos)` and apply the
  single move that most reduces the active objective. `O(N² · V · L²)` —
  expensive per call, but called once per offspring.
- **Swap best-move**: enumerate every *pair* of currently-routed orders on
  *different* vehicles and exchange them via append-style placement
  (matches the p-SA Swap operator). Apply the single best swap.

Both fall back to a no-op if no improving move exists. Validity is checked
on every variant; invalid candidates are skipped.

### 4.5 Crossover (`crossover.rs`) — Pop II

> *FSCIM (Fixed-Seed Cheapest Insertion).* Inherit complete routes from two
> parents, fill the rest by cheapest insertion.

```
1.  offspring = empty
2.  covered_orders = [false] * N
3.  used_vehicles  = [false] * V
4.  candidates_p1, candidates_p2 = non-empty route indices in each parent
5.  loop:
6.      a = try_inherit(offspring, parent1, candidates_p1, ...)
7.      b = try_inherit(offspring, parent2, candidates_p2, ...)
8.      if not a and not b: break
9.  recompute totals on the inherited skeleton
10. leftover = orders with covered_orders[o] == false
11. for each leftover: insert_cheapest(offspring, o, ...)
12. recompute totals; return offspring
```

`try_inherit` shuffles its candidate list, then linearly scans for the
first feasible route — feasible = (a) every covered order in the route is
*not* already covered in the offspring AND (b) the route's vehicle is
unused in the offspring. The first feasible route is taken; the index is
removed from the candidate list.

This is the key adaptation vs. [WC13]: the paper's homogeneous fleet
doesn't track vehicle usage. Our heterogeneous fleet does.

### 4.6 Fitness + roulette wheel (`fitness.rs`)

Rank-based linear fitness from [WC13] §4.2.5: rank 1 (best by active
objective) gets fitness `2L + 1 − rank` where `L` is the population length
the fitness was computed over (`2N` for offspring vectors). The minimum
fitness is clamped to `1.0` so degenerate roulette draws don't collapse.

`roulette_select(count)` performs `count` rounds of roulette-wheel sampling
*without replacement*. If every remaining individual has zero fitness it
falls back to uniform sampling.

## 5. Configuration (`config.rs`)

| Field | Default | What it does | When to tune |
|---|---|---|---|
| `population_size` | 50 | `N` for both Pop I and Pop II. | Per scale class; smaller for large N to fit memory. |
| `conv_count` | 500 | Stop after this many gens with no global-best improvement. | Larger = better quality, longer runtime. Tune up first if quality plateaus before time cap fires. |
| `wall_time_cap_ms` | `Some(30 min)` | Hard wall-clock cap. `None` = unlimited. | Always set in benchmark runs; never unlimited in batch scripts. |
| `recombination_fraction_low` / `_high` | 0.1 / 0.5 | Pop I removal fraction range. | [WC13] default; rarely tuned per the paper. |
| `p_reinsertion` | 0.5 | Probability that local improvement uses Reinsertion (vs Swap). | 0.5 is the paper's "either one" reading; sweep ∈ [0.3, 0.7] in tuning. |
| `p_crossover` | 0.5 | Fraction of Pop II offspring produced by Crossover (vs Local Improvement). | Worth a sensitivity sweep since the paper doesn't pin this. |

`CeaConfig::small_for_tests()` is a tiny variant for unit tests / fixtures.

## 6. Data structures

CEA shares the mutable representation with `vrppd-psa` — `WorkingSolution`,
`WorkingRoute`, `WorkingStop`, `OrderMatrix`, `VehicleStartMatrix` all live
in `vrppd-core::working`. The same two invariants apply:

- Pickup-before-delivery within each route.
- Each order serviced exactly once across all routes.

`WorkingSolution::is_valid(problem)` checks both. CEA-only types
(`Individual`, `Population`) live in `population.rs` and are thin wrappers.

## 7. Code map

| File | What's there | When to read |
|---|---|---|
| `lib.rs` | Public re-exports, module declarations | First — surface area. |
| `config.rs` | `CeaConfig` + `Default` / `small_for_tests` | Right after — parameter vocabulary. |
| `population.rs` | `Individual`, `Population`, best-finder | Before any operator — they all consume `Population`. |
| `rscim.rs` | `generate_rscim`, `insert_cheapest` | Before the top-level loop — initial solutions feed pop1 and pop2. |
| `reproduction.rs` | `reproduce_elite` (one-liner) | Anywhere — trivially short. |
| `recombination.rs` | `recombine` (Pop I operator) | Before reading `coevolve::evolve_pop1`. |
| `local_improvement.rs` | `local_improve` and the two best-move helpers | The most code per file outside `coevolve.rs`. |
| `crossover.rs` | `crossover` + `try_inherit` (FSCIM Pop II) | After `recombination.rs` (shares `insert_cheapest`). |
| `fitness.rs` | `fitness_values`, `roulette_select` | Whenever you need to recall the rank formula. |
| `coevolve.rs` | `solve_cea_seeded`, `evolve_pop1`, `evolve_pop2`, `survive_n` | **Last** — it orchestrates everything above. |
| `tests/cea_quality.rs` | Quality-against-BF integration test | For the parity story; don't touch unless changing the contract. |

## 8. Reading order for hand-rewrite

1. `lib.rs` — note the public surface.
2. `config.rs` — internalise field names and units.
3. `population.rs` — short and shows up everywhere.
4. `vrppd-core::working::WorkingSolution` — same prerequisite as p-SA.
5. `rscim.rs` — start with `choose_seed_count`, then trace one order through
   the seed phase and the cheapest-insertion phase.
6. `reproduction.rs` — three lines.
7. `fitness.rs` — `fitness_values` then `roulette_select`. Note the
   `2L + 1 − rank` formula and the without-replacement scheme.
8. `recombination.rs` — Pop I operator. Trace one offspring end-to-end.
9. `local_improvement.rs` — Pop II local move set. The two helpers are
   independent; read either order.
10. `crossover.rs` — Pop II crossover (FSCIM). The vehicle-uniqueness rule
    in `try_inherit` is the most-likely-to-trip-on detail.
11. `coevolve.rs` — finally read the loop and confirm everything plugs in.

After reading, run `cargo test -p vrppd-cea` (operators) and the slower
`cargo test -p vrppd-cea --release -- --ignored` if any quality tests are
gated.

## 9. Open items for the thesis

For chapter 5.2 *Algorithm: CEA* and chapter 8 *Results*:

- **Operator-rate study**: `p_crossover` and `p_reinsertion` are not fixed
  by [WC13]; defaults are 0.5 each. Worth a small grid to argue why.
- **`conv_count = 500` vs wall-time cap**: which terminates first at each
  scale class? Report the distribution.
- **Recombination fraction range** `[0.1, 0.5]`: paper default, not
  validated on this variant. Sweep low / high in tuning.
- **Migration cadence**: we migrate Pop I's best into Pop II every
  generation (paper's default). Cheap to vary; could test every 5 / 10
  generations.
- **RSCIM `Empty` coefficient (0.4)**: shared with p-SA; one global sweep
  produces values for both algorithms.
- **Tie-breaking determinism** in `Population::best_index` (lower index
  wins) is needed for reproducibility but means the elite is sticky on
  plateaus; document in chapter 5.2.5.
