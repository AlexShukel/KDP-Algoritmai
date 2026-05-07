# vrppd-brute-force — Exact brute-force solver

> Companion document for the `vrppd-brute-force` crate. Read alongside the
> source — the crate is small (~500 lines across four files).

## 1. What this crate is

An exact brute-force solver for the project's specific VRPPD variant.
Returns the **best solution per objective** in one call (not three
separate runs):

- `best_distance_solution`
- `best_price_solution`
- `best_empty_solution`

This is the *ground-truth oracle* used to validate every other solver
(p-SA, CEA, MILP, LP-LB) on small instances.

The implementation is two-level enumeration:

1. **Outer** (`solve_recursive` in `lib.rs`): enumerate which subset of
   orders each vehicle receives. A vehicle gets a `u32` bitmask over
   orders. Total state space: `(V+1)^N` worst case (each order goes to
   one of V vehicles or stays unassigned), pruned by branch-and-bound on
   all three objectives simultaneously.
2. **Inner** (`solve_tsp` in `tsp.rs`): for each `(vehicle, order_subset)`
   pair, find the optimal precedence-respecting tour by memoised DFS
   over `(pickup_mask, deliver_mask)` state. Cache key:
   `vehicle_idx · 2^N + target_mask`.

## 2. Practical scale

The exponential outer loop puts a hard ceiling on what BF can solve:

| N (orders) | Status |
|---|---|
| ≤ 7 | Seconds. Used for all parity / quality tests. |
| 8–10 | Tens of seconds. Used for the cut matrix's smallest class. |
| 11–14 | Minutes. Used for parity validation; not used in main runs. |
| ≥ 15 | Hours / impractical. MILP takes over above this point. |

The 16-byte `PathBuffer` (`[u8; 16]` + len in `types.rs`) is the
hard-coded ceiling for path length, which corresponds to **8 orders**
(2 stops each). Beyond that, the `nodes` array would overflow — the
buffer has to grow before BF can run on `N > 8`. This is intentional:
BF is the oracle, not a production solver, and the small fixed buffer
keeps the inner DFS cache-friendly.

## 3. Algorithm in pseudo-code

### 3.1 Outer enumeration (`lib.rs::solve_recursive`)

```
state at recursion node:
  vehicle_idx, assignment_mask, current_dist, current_price, current_empty
prune iff:
  current_dist ≥ best_dist_so_far
  AND current_price ≥ best_price_so_far
  AND current_empty ≥ best_empty_so_far

base case:
  assignment_mask == full_mask (all orders assigned)
  → record best per objective

recursive step:
  remaining_mask = full_mask XOR assignment_mask
  enumerate every non-empty submask of remaining_mask (Gosper-style):
    submask starts at remaining_mask;
    submask = (submask − 1) AND remaining_mask
    until submask == 0
  for each submask s:
    res = solve_tsp(vehicle_idx, s)         # memoised
    if res.valid:
      recurse with vehicle_idx + 1,
                   assignment_mask | s,
                   current_*  + res.min_*.total_*
  also recurse with vehicle_idx + 1 leaving this vehicle empty
```

Three things make this fast enough to be useful at `N ≤ 14`:

- **Submask enumeration via `(s − 1) AND remaining_mask`** — Knuth's
  classic; iterates exactly the non-empty subsets of `remaining_mask`
  in `O(2^|remaining|)` time, no branching to skip non-subsets.
- **Branch-and-bound on all three objectives at once** (the early
  return when *all three* current values exceed their respective best —
  short-circuiting *any* of the three doesn't apply because the
  best-per-objective tracking is independent).
- **Memoised inner TSP** — `(vehicle_idx, target_mask) → best_per_obj`.
  Hit rate is high in practice because the same vehicle/subset combos
  recur across different outer prefixes.

### 3.2 Inner TSP (`tsp.rs::solve_tsp`)

```
state at DFS node:
  last_node (None at start, then 2*o or 2*o+1),
  current_dist, current_empty, current_price, current_load,
  pickup_mask, deliver_mask,
  path_buffer

goal:
  deliver_mask == target_mask  (every assigned order delivered)

per call:
  cache_key = vehicle_idx · 2^N + target_mask
  if cache_key in memo: return cached value
  run DFS, store result, return
```

For each step, choose any `o` in `target_mask` whose:

- `pickup_mask` bit is 0 → emit a pickup leg if `current_load + load_o ≤
  MAX_LOAD`; recurse.
- `pickup_mask` bit is 1 and `deliver_mask` bit is 0 → emit a delivery
  leg; recurse.

Empty distance is accounted for at the *moment of the first pickup
after a fully-empty period*: a leg is empty iff the vehicle's load was
zero just before the leg, which is equivalent to `pickup_mask ==
deliver_mask` (every previously picked-up order has also been delivered)
at the time of the pickup. The leg's distance is then added to
`current_empty`. Once a pickup is in flight, every subsequent leg until
all in-flight orders are delivered counts as loaded (not empty).

This load-aware EMPTY definition is **the** semantic difference from the
MILP's `Z_empty = total − Σ y · atstumas_o`. The MILP variant assumes
*every* pickup→delivery interval is loaded for the whole interval; the
implementation tracks load segment by segment and counts as empty only
those legs where load = 0. See `documents/MILP_adaptation_notes.md` §2.4
for the full derivation; this is the reason `vrppd-milp` and
`vrppd-bounds::lp` short-circuit `Empty` to errors / 0.

### 3.3 Per-call best-tracking

`solve_tsp` returns three results in one shot:

```rust
InternalBestResults {
    min_dist:  InternalTspResult,  // best by distance, with the path
    min_empty: InternalTspResult,  // best by empty
    min_price: InternalTspResult,  // best by price
    valid:     bool,
}
```

The trick (lines 22–24 in `tsp.rs`) is that each "best" tracker stores
not just its primary metric but the other two as secondaries
(`(val, path, secondary, tertiary)`). This way, after the DFS finishes
each best record carries a full triple of metrics, and the outer
recursion can sum its preferred objective without re-running the inner
TSP per objective.

## 4. Data structures

| Type | File | Role |
|---|---|---|
| `SolverContext` | `context.rs` | All shared state: orders, vehicles, flat distance matrices, memo table, current best-per-objective values + their assignment vectors. Built once per problem. |
| `PathBuffer` | `types.rs` | `[u8; 16]` + `u8 len`. Encodes a tour as a sequence of node ids (`2*o = pickup_o`, `2*o + 1 = delivery_o`). Hard ceiling at 16 nodes = 8 orders. |
| `InternalTspResult` | `types.rs` | One per-objective best: path + (dist, empty, price). |
| `InternalBestResults` | `types.rs` | Triple of `InternalTspResult` + a `valid` flag. The `valid` flag is `false` iff the DFS exhausted without finding any feasible completion (e.g. capacity infeasible). |

`SolverContext` is mutable throughout the run because:

- the `memo` table grows as `solve_tsp` is called;
- `best_dist`, `best_price`, `best_empty` and their assignment vectors
  update as the outer loop finds new champions.

## 5. Output reconstruction (`reconstruct_solution`)

Once the outer loop terminates, `solve` calls `reconstruct_solution`
once per objective. It iterates over each vehicle's recorded assignment
mask, calls `solve_tsp` again (cache hit — `O(1)`) to recover the path,
and walks the `PathBuffer.nodes` array converting each `u8` back to a
`(order_id, StopKind::Pickup | Delivery)` pair.

Per-vehicle totals are summed into `ProblemSolution::total_distance`
etc.; the `routes` map is keyed by `vehicle.id.to_string()` to match the
TS harness's expected output shape.

## 6. Code map

| File | Purpose |
|---|---|
| `src/lib.rs` | `solve` (public), `solve_recursive` (outer enumeration), `reconstruct_solution`, `Objective` (private enum mirroring `vrppd_core::Objective` for ergonomics inside this crate). |
| `src/context.rs` | `SolverContext::new`: builds flat distance matrices and the memo cache. |
| `src/tsp.rs` | `solve_tsp` + the inner `dfs` (precedence-respecting state-space DFS). The hottest function in the crate. |
| `src/types.rs` | `PathBuffer`, `InternalTspResult`, `InternalBestResults`. ~20 lines. |
| `tests/golden.rs` | Snapshot tests against canonical small fixtures. The contract: BF output is byte-stable on these fixtures; any change is intentional. |

## 7. Reading order for hand-rewrite

1. `types.rs` — three structs, takes one minute. Internalise the
   `PathBuffer` size limit.
2. `context.rs` — one constructor; trace one (i, j) pair through the
   distance-matrix initialisation.
3. `lib.rs` — top-down. Read `solve`, then `solve_recursive`, then
   `reconstruct_solution`. The submask-enumeration trick on lines
   104–131 is worth reading twice.
4. `tsp.rs` — the longest file; read top-down. The inner `dfs` is
   self-contained; the outer wrapper only handles cache + result shape.
5. `tests/golden.rs` — the contract.

## 8. Open items for the thesis

For chapter 5.0 *Bazinis algoritmas: brute-force* (or wherever you place
the oracle):

- **`PathBuffer` size**: lift from `[u8; 16]` to `[u8; 32]` if you ever
  want BF results at `N = 16`. Cheap, but pushes the runtime ceiling
  badly.
- **EMPTY semantic difference**: this crate computes the load-aware
  empty distance; the MILP and LP-LB compute the §2.4 empty formula.
  Document this difference once in the thesis (chapter 6 / §2.4) and
  reference it from chapters 5.0, 5.3, and 6.
- **Branch-and-bound effectiveness**: log the prune-rate at each `N`
  in a thesis appendix; surprising for [WC13] / VRP audiences who
  rarely see exact BF on this scale.
- **Triple-objective best tracking** (each tracker holds `(primary,
  path, secondary, tertiary)`) is unusual; worth one paragraph in
  chapter 5.0 — it's why we get all three optima per call without
  triple-running the DFS.
