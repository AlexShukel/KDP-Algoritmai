# vrppd-psa — Parallel Simulated Annealing

> Companion document for the `vrppd-psa` crate. Designed to be read alongside
> the source as a teaching artifact while you hand-rewrite the algorithm to
> internalise it. Source-code comments cover the *what*; this document covers
> the *why* and the *how-it-fits-together*.

## 1. What this crate is

A simulated-annealing solver for the project's specific VRPPD variant:
heterogeneous fleet, point-to-point pickup/delivery orders, strict pickup
precedence, three switchable objectives (`Empty`, `Distance`, `Price`).

There are two entry points:

| Entry | Function | Use case |
|---|---|---|
| Single-thread | `sa::solve` / `sa::solve_seeded` | Tests, small problems, reproducibility checks |
| Multi-thread pipeline | `pipeline::solve_pipeline` / `_seeded` | Production runs (the napi binding goes here) |

Both share the same `SaConfig`, the same operator set (`operators.rs`), and
the same RCRS initial solution (`rcrs.rs`). The pipeline is just an
orchestration layer on top of the single-thread loop.

## 2. Reference paper [WMZ+15]

> Wang, C. et al. *A parallel simulated annealing method for the vehicle
> routing problem with simultaneous pickup–delivery and time windows.*
> Computers & Industrial Engineering 83 (2015).

The crate's design is a problem-specific adaptation of [WMZ+15] §3–4. The
paper's contributions used here:

- **Pipeline parallelism**: workers form a chain; worker *i* periodically
  forwards its current best to worker *i+1* as an *influence message* that
  *i+1* may adopt with a re-heat (paper §4.2). We use the same shape — see
  `pipeline.rs`'s `Influence` / `Report` types.
- **Re-heating on adoption**: after adopting an influence the receiving
  worker's temperature is raised back to a floor (paper §4.2; `reheat_floor`
  in `SaConfig`, default 50.0).
- **Operator set**: the paper uses Shift / Swap / Local-Search; we replace
  Local-Search with **Intra-Shuffle** because the problem variant treats
  intra-route order resequencing as the most useful local move (the project
  README and PLAN.md §1.1 cover the rationale).

Differences from [WMZ+15] (record these as adaptation notes for thesis
chapter 5.1):

1. **Time windows**: not modelled. The variant has *strict pickup dates*
   (a single allowed pickup day per order) which the validity check in
   `WorkingSolution::is_valid` enforces, but no soft windows.
2. **Simultaneous pickup-delivery**: the project variant is *point-to-point*
   (each order has a distinct pickup and delivery node), unlike the paper's
   single-node simultaneous variant.
3. **Heterogeneous fleet**: per-vehicle `price_km` enters the objective only
   in the `Price` mode; the paper's homogeneous fleet collapses this to
   distance.
4. **Three switchable objectives**: paper uses a single objective; we run the
   solver three times (one per `Objective`) so the thesis can compare across
   `Empty` / `Distance` / `Price` Pareto views.

> Source PDF is **not** in `documents/papers/` yet — drop it there once you
> have the bibliographic copy so cross-references are easy to find. The
> coursework PDF `documents/Kursinis_darbas.pdf` already discusses the paper
> in Lithuanian and can be lifted (translated) into thesis chapter 5.1.

## 3. Algorithm in pseudo-code

### 3.1 Single-thread `solve` (`sa.rs`)

```
input: problem P, target T (Empty/Distance/Price), config C
output: solved.solution + convergence trace

1.  matrices  = build OrderMatrix and VehicleStartMatrix from P
2.  current   = generate_rcrs(P, T, rng)            # feasible warm start
3.  best      = current
4.  T_temp    = C.initial_temp
5.  for iter in 1..C.max_iterations:
6.      if T_temp < C.min_temp: break
7.      neighbour = generate_neighbor(current, ..., C.weights, rng)
8.      if neighbour is None: skip                 # operator self-rejected
9.      Δ = E(neighbour) - E(current)              # E(·) = T's energy fn
10.     accept = Δ < 0 OR Uniform(0,1) < exp(-Δ / T_temp)
11.     if accept:
12.         current = neighbour
13.         if E(current) < E(best):
14.             best = current
15.             history.push(time, iter, metrics)
16.     T_temp *= C.cooling_rate                   # geometric cooling
17. return best, history
```

The *Metropolis* acceptance step (10) is the textbook SA kernel —
[WMZ+15] uses the same.

### 3.2 Multi-thread `solve_pipeline` (`pipeline.rs`)

```
1.  initial = generate_rcrs(...)                   # built once on coordinator
2.  spawn N = config.threads workers, each with:
       - shared Arc<Problem>, Arc<OrderMatrix>, Arc<VehicleStartMatrix>
       - own seed = master_seed XOR worker_idx (deterministic split)
       - bounded(1) influence inbox
       - shared coordinator outbox
3.  worker(i) loop:
       3.1  drain inbox: if a better solution arrived, adopt + reheat T_temp
            to max(T_temp, reheat_floor)
       3.2  run config.batch_size SA steps (same Metropolis kernel as 3.1)
       3.3  every config.sync_interval batches, send Sync(best) to coordinator
       3.4  on termination, send Done(best)
4.  coordinator loop:
       4.1  on each Report, if it improves global best → record + history
       4.2  on Sync, forward Influence to worker (i+1) using try_send
            (non-blocking; paper §4.2 — keep only the most recent)
       4.3  on Done, decrement alive counter; exit when zero
5.  return global_best, merged history
```

Read together with `pipeline.rs` lines 113–142 (coordinator) and 156–250
(worker). The bounded(1) inbox + non-blocking `try_send` is the
"most-recent-wins" coalescing the paper specifies, implemented at the
channel level rather than as an explicit queue.

## 4. Data structures (in `vrppd-core::working`)

The mutable representation lives in `vrppd-core` so it's shared with
`vrppd-cea`. Memorise these — they show up everywhere:

| Type | Role |
|---|---|
| `WorkingSolution` | Vec\<WorkingRoute\>, plus precomputed totals (total_distance, empty_distance, total_price). Mutable — we shuffle stops in place during operator application. |
| `WorkingRoute` | One vehicle's stop sequence + cached per-route totals. |
| `WorkingStop` | `(order_idx, StopKind)` where `StopKind ∈ {Pickup, Delivery}`. Always strictly ordered: pickup precedes delivery for a given order within its route. |
| `OrderMatrix` | Pre-computed pairwise great-circle distances between order endpoints. Built once per problem, shared read-only across threads. |
| `VehicleStartMatrix` | Pre-computed distances from each vehicle's start to each order's pickup. Used by RCRS's `Empty` cost and by some recompute paths. |

Two invariants every operator must preserve (checked by `is_valid`):

- **Pickup-before-delivery**: for each order, its pickup index in the route is
  strictly less than its delivery index.
- **Each order serviced exactly once**: across all routes, every order id
  appears in exactly one route, with one pickup and one delivery.

## 5. Operators (`operators.rs`)

Choice rule (lines 45–53): a single uniform `r ∈ [0,1)` selects the
operator by weighted bands `weights = (shift, swap, shuffle)` summing to 1.0.
Default `(0.4, 0.3, 0.3)` — `shift` is favoured because it's the most
exploratory move on this variant (changes both vehicle assignment and
intra-route position).

### 5.1 Shift (`apply_shift`, lines 62–98)

> Lift one order out of one route, re-insert into a (possibly different)
> route at randomly chosen pickup and delivery positions.

- **Source vehicle**: uniform over *non-empty* routes.
- **Destination vehicle**: uniform over **all** routes (including empty).
  Critical detail — the TS code samples destination from `vIds`, not
  `nonEmpty`. The Rust port preserves this for parity (line 73 comment).
- **Pickup position**: uniform in `[0, len]` of destination's stops.
- **Delivery position**: uniform in `(pickup_pos, len_after_pickup]`. The
  bounds matter: delivery can be inserted *strictly after* pickup but no
  earlier, which is what makes this operator pickup-precedence-safe by
  construction.

### 5.2 Swap (`apply_swap`, lines 100–141)

> Pick one order from each of two non-empty routes and exchange them.

The implementation is *append-style*: after removing the two orders from
their original routes, the new pickup+delivery pairs are pushed onto the
**tail** of the receiving route, not re-inserted at random positions.
This is the [WMZ+15] "Lazy Swap" variant — chosen because random insertion
positions tend to produce many invalid candidates that the validity check
then rejects, wasting iterations. Tail-append is always feasible
(pickup-before-delivery is preserved) and simpler.

Trade-off: tail-append is conservative — it can't introduce new
intra-route orderings. That's fine because Intra-Shuffle does the
intra-route work.

### 5.3 Intra-Shuffle (`apply_intra_shuffle`, lines 143–179)

> Within one non-empty route with at least 4 stops (≥2 orders), randomise
> the order *sequence*; each order's pickup is placed immediately before its
> delivery.

Skip condition: route has fewer than 4 stops (line 150). With < 2 orders
there's nothing to shuffle.

Sequence: extract distinct order ids in insertion order → Fisher–Yates
shuffle (lines 162–166) → rebuild stops as `[Pickup(o1), Delivery(o1),
Pickup(o2), Delivery(o2), ...]`. By construction every shuffle is valid
(precedence preserved; identical multi-set of orders).

This is the operator that takes a route with bad sequencing and lets it
re-find a good one without inter-route moves. Without it, Shift and Swap
struggle to clean up intra-route inefficiency.

## 6. RCRS initial solution (`rcrs.rs`)

> Greedy insertion of a randomly-ordered queue of orders into routes,
> selecting the cheapest (vehicle, pickup-pos, delivery-pos) triple per
> order under an objective-specific cost function.

For each order in shuffled order, evaluate **every** insertion position
across **every** vehicle:

```
for v_idx in 0..V:
    for pickup_pos in 0..=route_len:
        for delivery_pos in (pickup_pos+1)..=(route_len+1):
            metrics = estimate_insertion(...)        # None → infeasible, skip
            cost   = match target {
                Price    => Δtotal_distance × vehicle.price_km,
                Distance => Δtotal_distance,
                Empty    => Δempty_distance + 0.4 × vstart(v, o),
            }
            track minimum
insert at the best (v, pickup_pos, delivery_pos)
```

Notes:

- **Cubic per order in route length** — fine for the project's instance
  sizes (largest in the main matrix is N=200) but quadratic in N overall.
  The paper's RSCIM uses a cheaper rule; we keep the project's version for
  parity with the coursework.
- **`Empty` mode's 0.4 coefficient** (line 61) is documented in PLAN.md §6
  and is one of the parameters flagged for sensitivity analysis (sweep 1.0,
  1.5, 2.0). Don't change it without recording the run.
- **Randomised order queue** (line 35) is the only stochasticity in RCRS;
  different RNG seeds → different starting solutions → different final SA
  results.

## 7. Hyperparameters (`config.rs`)

| Field | Default (Distance) | What it does | When to tune |
|---|---|---|---|
| `initial_temp` | 500.0 | Start of geometric cooling. Higher → more early acceptance of worse moves. | Tune up if convergence stalls early; tune down if early iterations are pure random walk. |
| `cooling_rate` | 0.999 | Geometric multiplier each iteration. 0.999 = slow cooling. | `0.99` cools 10× faster; use for short budgets. |
| `min_temp` | 0.1 | Floor — exits the loop early when crossed. | Rarely; only if quality is plateauing well before `max_iterations`. |
| `max_iterations` | 10 000 | Hard cap on iterations regardless of temperature. | Per-scale-class, in tuning. |
| `weights` | (0.4, 0.3, 0.3) | Operator selection probabilities. Must sum to 1.0. | Sweep when adding a fourth operator. |
| `threads` | `max(2, num_cpus)` | Pipeline width. | Set to physical core count on the benchmark host. |
| `batch_size` | 100 | SA steps per worker between sync checks. | Smaller → tighter influence cadence at sync-overhead cost. |
| `sync_interval` | 4 | Number of batches between Sync messages. | Larger → less coordinator chatter, slower influence flow. |
| `reheat_floor` | 50.0 | Minimum temperature after adopting an influence. | Increase for more diversification on adoption. |

Per-objective tuned defaults are in `default_config_for(target)` and were
obtained from the project's `tune-psa` sweep on 7×7 (PLAN.md §2). They will
be re-tuned at N=14 / N=50 scale classes during Phase 4.1 (see queue R02,
R03, R06).

## 8. Code map

| File | What's there | When to read |
|---|---|---|
| `lib.rs` | Public re-exports + module declarations | First — to see the surface area. |
| `config.rs` | `OperatorWeights`, `SaConfig`, `default_config_for` | Right after — gives you the parameter vocabulary. |
| `rcrs.rs` | `generate_rcrs` (initial solution); `Insertion` helper | Before reading `sa.rs`, since SA starts from RCRS output. |
| `operators.rs` | `generate_neighbor` and the three apply_* helpers + tests | The heart of the algorithm. Read carefully — this is most of the [WMZ+15] adaptation. |
| `sa.rs` | Single-thread `solve`, `solve_seeded`, `anneal` | The Metropolis kernel. Short and worth memorising. |
| `pipeline.rs` | `solve_pipeline`, coordinator, worker thread, message types | Read last — it's an orchestration layer that reuses everything above. |
| `tests/sa_quality.rs` | Quality-against-BF integration test | For the parity story; don't touch unless changing the contract. |

## 9. Reading order for hand-rewrite

1. Skim `lib.rs` — note the public surface.
2. Read `config.rs` end-to-end. Internalise field names; they appear
   everywhere.
3. Read `vrppd-core::working::WorkingSolution` (separate crate). Without
   this, the operators won't make sense.
4. Read `rcrs.rs`. Trace one order's insertion from line 37 to line 93.
5. Read `operators.rs`. For each `apply_*`, walk through its post-conditions
   against the two invariants in §4 above.
6. Read `sa.rs`. The whole `anneal` loop is < 50 lines; understand every
   line.
7. Read `pipeline.rs`. Diagram the coordinator + worker on paper before
   trying to read the Rust.
8. Run `cargo test -p vrppd-psa` — both files in `tests/` and the inline
   `#[cfg(test)] mod tests` in `operators.rs`.

## 10. Open items for the thesis

These are notes for chapter 5.1 *Algorithm* / 5.1.x *Adaptations* /
chapter 8 *Results*:

- **Operator-weight sensitivity**: weights default `(0.4, 0.3, 0.3)` —
  thesis-grade study should sweep at least three (low/medium/high)
  configurations at each scale class.
- **`reheat_floor = 50.0`** is taken from the TS port; the paper specifies a
  formula instead. Worth a short paragraph on why a fixed floor was used.
- **Pipeline width**: at N=10 the overhead-to-work ratio favours fewer
  threads. Likely worth measuring.
- **RCRS `Empty` coefficient** (0.4): planned sensitivity sweep per
  PLAN.md §6.
- **Stopping rule**: pure `max_iterations` cap. The paper uses a
  *non-improvement count* (CONV_COUNT) instead. This is a documented
  difference but could be replaced with a hybrid stop without much code.
