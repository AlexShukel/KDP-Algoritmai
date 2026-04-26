# Bakalauro baigiamojo darbo planas

**Tema:** Euristinių algoritmų palyginimas ir apatinių ribų analizė specifiniam VRPPD uždaviniui
**Autorius:** Aleksandras Šukelovič
**Vadovas:** Adomas Birštunas
**Repozitorija:** [Bakalauro-baigiamasis-darbas](https://github.com/AlexShukel/Bakalauro-baigiamasis-darbas)
**Pirminis darbas:** [KDP-Algoritmai](https://github.com/AlexShukel/KDP-Algoritmai)

---

## 1. Executive summary

The bachelor's thesis extends the coursework project along two complementary axes:

- **Framing A — Comparative study.** A second metaheuristic (Coevolutionary Algorithm, CEA) is implemented alongside the existing p-SA. The two are compared head-to-head on the same specific VRPPD formulation under equal time budgets, across three objectives (EMPTY / DISTANCE / PRICE), and using an approximated Pareto front.
- **Framing B — Scaling and bounds.** The current evaluation is capped at N=14 because Brute Force is the only ground truth. The thesis extends the evaluation range by (1) adding a MILP solver baseline (CPLEX / Gurobi / CBC) for N≈10–30, (2) deriving lower bounds (trivial direct-sum bound plus an LP-relaxation bound from the existing MILP model) usable at any scale, and (3) running both metaheuristics on N ∈ {50, 100, 200, 500}.

The research question the thesis answers: **for this specific VRPPD variant (heterogeneous fleet, point-to-point orders, strict pickup dates, multi-objective), which metaheuristic strategy — trajectory-based (p-SA) or population-based (CEA) — performs better, and how does that answer change with problem scale and chosen objective?**

The primary contribution is empirical; a secondary contribution is the problem-specific adaptation of both algorithms (particularly the CEA operators that must respect strict pickup precedence and heterogeneous vehicle costs).

---

## 2. Existing assets (as of April 2026)

From the [KDP-Algoritmai](https://github.com/AlexShukel/KDP-Algoritmai) repository:

- **Problem generator** (`generate-data.ts`, `generate-problems.ts`): produces geographically realistic instances up to 7×7.
- **Brute Force solver**: implemented in Rust (originally `rust-solver/`, now lifted into `crates/vrppd-brute-force/` with the napi shell at `crates/napi-bridge/`). The earlier NodeJS variant has been retired. Finds optima for all three objectives in a single run.
- **p-SA**: NodeJS with Worker Threads, RCRS initial solution, Shift / Lazy Swap / Intra-Shuffle operators, island-model synchronization with re-heating.
- **Parameter tuning tool** (`tune-psa`): automated sweep on 7×7 instances.
- **Benchmarking harness**: full experimental pipeline with charts (490 problems × 3 objectives × 10 reps = 14 700 runs).
- **Results** from the project: 92.3% optimal hit rate, <1% RPD for N ≤ 10, ~2% RPD at N=14.

From the coursework thesis (`Kursinis darbas`):

- **MILP formulation** (sets, parameters, decision variables, objective, constraints including MTZ for subtour elimination).
- **Literature review** of p-SA [WMZ+15] and CEA [WC13] with gap analysis against the specific problem.

---

## 3. Thesis scope and contributions

### Scope (in)

1. Port p-SA to Rust; keep NodeJS version as validation reference.
2. Implement CEA (first time) with problem-specific adaptations.
3. Add MILP solver integration to the harness.
4. Derive and implement two lower bounds:
    - **LB_direct**: Σ of direct pickup→delivery distances (loose for EMPTY/PRICE, tight for DISTANCE's loaded portion).
    - **LB_LP**: LP relaxation of the MILP model — drop integrality on `x_ijv`, `y_ov`.
5. Extend the problem generator for N ∈ {10, 20, 50, 100, 200, 500}.
6. Re-tune both algorithms at 2–3 scale classes (small / medium / large).
7. Run the unified comparison matrix.
8. Multi-objective analysis using hypervolume indicator over the three objectives.
9. Write the thesis (~50–70 pages, Lithuanian).

### Scope (out)

- Other metaheuristics (tabu search, ALNS, GRASP, GA) — mentioned in related-work only.
- Time windows beyond the existing strict-date model.
- Real road distances (Euclidean is explicitly allowed by the problem definition).
- Production deployment or real-time routing.
- Stochastic demand / dynamic re-optimization.

### Contributions

1. First implementation and adaptation of CEA for this specific problem variant (heterogeneous fleet, point-to-point, strict pickup dates).
2. Rust port of p-SA with measured speedup over NodeJS.
3. Empirical comparison of trajectory-based vs population-based metaheuristics at scales impossible for exact methods.
4. LP-relaxation lower bound usable up to at least N=500, validated against exact optima for N ≤ 20.
5. Extended multi-objective analysis using a formal Pareto front quality indicator.

---

## 4. Architecture evolution

### Current structure (KDP-Algoritmai)

```
KDP-Algoritmai/
├── src/                     # TypeScript: p-SA, harness, validation
├── crates/napi-bridge/      # NAPI cdylib: TS↔Rust bridge (was rust-solver/)
├── crates/vrppd-core/       # Rust: shared problem model + Haversine
├── crates/vrppd-brute-force/ # Rust: Brute Force (lifted from rust-solver/)
├── generate-data.ts         # seed-data generation
├── generate-problems.ts     # problem-instance generation
├── generate-charts.ts       # chart rendering
├── sample_problems.zip
└── package.json
```

### Proposed structure (Bakalauro-baigiamasis-darbas)

Cargo workspace as the primary organization, with TypeScript retained only for the parts where it adds value (chart rendering, notebook-style analysis):

```
Bakalauro-baigiamasis-darbas/
├── crates/
│   ├── vrppd-core/          # problem model, solution, validation, distances, JSON I/O
│   ├── vrppd-bounds/        # direct-sum LB, LP-relaxation LB, MILP model builder
│   ├── vrppd-brute-force/   # ported from rust-solver/
│   ├── vrppd-psa/           # NEW: Rust port of p-SA
│   ├── vrppd-cea/           # NEW: CEA implementation
│   ├── vrppd-milp/          # NEW: MILP solver adapter (good_lp or rust-milp-solver)
│   ├── vrppd-generator/     # instance generation, scaled up from current
│   └── vrppd-runner/        # unified experiment harness — replaces current TS harness
├── analysis/                # TypeScript / Python notebooks
│   ├── charts.ts            # chart generation (lifted from KDP-Algoritmai)
│   └── stats.py             # hypervolume, statistical tests
├── problems/                # generated instance bank (gitignored; rebuildable)
├── results/                 # experiment output (gitignored; archived elsewhere)
├── thesis/                  # LaTeX source
└── PLAN.md                  # this file
```

**Why a full Rust workspace:** the project already showed 3× on Brute Force. At N=200+ with 10 replications × 3 objectives, p-SA in NodeJS would take days; Rust reduces that to hours. Also, a shared `vrppd-core` crate eliminates the duplication risk between BF's Rust implementation and the rest of the TypeScript codebase.

**What NOT to rewrite:** the chart generation (`generate-charts.ts`) works well and Python/TypeScript are better for this anyway. Only the solver + harness move.

---

## 5. Implementation phases

Estimates assume part-time work over ~6 months. Adjust to actual deadlines.

### Phase 0 — Project bootstrap (1 week)

- Initialize Cargo workspace in the bachelor's repo.
- Import `rust-solver/` as `crates/vrppd-brute-force/` (possibly with small refactoring into the shared core).
- Port the JSON problem format and distance calculations into `vrppd-core`.
- Set up CI (GitHub Actions: cargo build, test, clippy, fmt).
- Write the golden-output test harness: feed small canonical problems through BF, snapshot the solutions, use as regression tests.

### Phase 1 — Infrastructure hardening (3 weeks)

**1.1. Port p-SA to Rust (2 weeks).** Use `rayon` or raw `std::thread` with `crossbeam` channels for the island model. Match the existing NodeJS behavior bit-for-bit on fixed seeds (this is why you keep NodeJS alive during the port — it's the oracle). Validate:

- Same initial solution given the same seed and RCRS input.
- Same solution after N iterations given the same seed and operator weights.
- Same final quality distribution on the 490-problem set.

**1.2. Extend the generator (3 days).** Add size classes: 10×10, 20×10, 50×20, 100×30, 200×50, 500×100. Generate 20 instances per class. Total: ~140 large instances on top of the existing 490.

**1.3. Unified experiment runner (4 days).** Replace the current TS harness with a Rust CLI that takes `(algorithm, problem, objective, seed, config)` and emits a structured JSON record per run. Output schema:

```json
{
  "run_id": "...",
  "algorithm": "psa" | "cea" | "brute_force" | "milp",
  "problem_id": "...",
  "problem_size": {"N": 50, "V": 20},
  "objective": "empty" | "distance" | "price",
  "seed": 12345,
  "config": { ... },
  "result": {
    "solution": { ... },
    "empty_km": ..., "distance_km": ..., "price_eur": ...,
    "runtime_ms": ...,
    "iterations": ...,
    "convergence_trace": [ {"iter": 0, "best": ...}, ... ]
  },
  "validation": {"passed": true, "checks": [...]}
}
```

This schema is the single source of truth for all analysis downstream.

### Phase 2 — CEA implementation (4 weeks)

**2.1. RSCIM initial population (1 week).** [WC13]'s k = total_demand / avg_capacity heuristic translates roughly, but since all vehicles have the same capacity in this model, you can simplify to `k = total_load / vehicle_capacity`. For a population of size N_pop, generate N_pop different RSCIM orderings with distinct seeds.

**2.2. Population I operators — diversification (1 week).**

- Reproduction: elitist copy of best individual.
- Recombination: remove k ∈ [n/10, n/2] random orders, re-insert via RSCIM with existing routes as fixed seeds.
- Selection: roulette wheel on fitness = (4·N_pop + 1) − rank(TD).

**2.3. Population II operators — intensification (1 week).**

- Reproduction: as above.
- Local improvement: best-move Reinsertion and Swap, both precedence-safe. Reuse the lazy-append logic from the project's Swap operator.
- Crossover: FSCIM. Inherit complete routes from two parents, resolve conflicts (orders appearing in both parents' inherited routes must be kept only once), fill remaining orders via cheapest insertion into fixed seed routes.
- Selection: same roulette as Pop I.

**2.4. Inter-population migration (2 days).** Each generation, copy best(Pop I) into Pop II. This is the defining CEA mechanism.

**2.5. Adaptation to objective switch (2 days).** [WC13] uses NV-first / TD-second; your problem has three objectives and does not minimize NV. Remove the NV component; use the selected objective (EMPTY / DISTANCE / PRICE) directly in the fitness function. Verify this doesn't break the operators — RSCIM and FSCIM were both designed around distance-driven cheapest insertion.

**2.6. Parameter tuning (3 days).** Start with [WC13]'s defaults (SIZE_POP = 50 for both, CONV_COUNT = 500). Sweep on 7×7 using the existing `tune-psa` tool extended for CEA. Parameters to sweep: population sizes (25, 50, 100), convergence threshold (200, 500, 1000), recombination removal fraction (0.1, 0.2, 0.3, 0.5), crossover rate.

### Phase 3 — Bounds and MILP solver (3 weeks)

**3.1. Direct-sum lower bound (1 day).** Trivially computed from problem data. Equals Σ atstumas_o for all orders. This is a tight lower bound for the "loaded mileage" component of DISTANCE but a loose one for EMPTY and PRICE (EMPTY ≥ 0, PRICE ≥ min_price_per_km × Σ loaded_km).

**3.2. LP-relaxation lower bound (1.5 weeks).** Implement the MILP model from `Kursinis darbas` using `good_lp` or direct CBC/HiGHS bindings in Rust. Relax `x_ijv` and `y_ov` to [0,1]. The LP objective value is a valid lower bound on the MILP optimum. Expected tightness: 70–90% of optimum for small instances based on typical VRP relaxation behavior — but this needs to be measured, and that measurement is itself a thesis result.

**3.3. MILP solver baseline (1 week).** Same model, full integer constraints. Use academic CPLEX or Gurobi (free license) for best solver performance; fall back to HiGHS/CBC if open-source is preferred. Set a 30-minute timeout per instance. Expected solvable range: N ≤ 20–30 depending on constraint tightness. Record whether each instance was solved to optimality or only to best-known with optimality gap.

**3.4. Bound validation (3 days).** On all N ≤ 14 instances where BF optimum is known:

- Verify LP_LB ≤ BF_opt (correctness check).
- Measure LP_LB / BF_opt ratio (tightness).
- Verify MILP_solver_opt == BF_opt (sanity on both).

### Phase 4 — Experimental study (4 weeks)

**4.1. Re-tune at scale (1 week).** Parameters that work at N=14 won't be optimal at N=200. Re-tune p-SA and CEA separately at three scale classes: small (N=14), medium (N=50), large (N=200). Tuning metric: average RPD from LP_LB within a fixed time budget. Use the existing `tune-psa` pipeline extended to CEA. Budget: 60 seconds per run at small, 10 minutes at medium, 30 minutes at large.

**4.2. Main comparison matrix (2 weeks of compute, plus babysitting).**

| Algorithm   | N=10 | N=14 | N=20 | N=50  | N=100 | N=200 | N=500 |
| ----------- | ---- | ---- | ---- | ----- | ----- | ----- | ----- |
| Brute Force | ✓    | ✓    | —    | —     | —     | —     | —     |
| MILP solver | ✓    | ✓    | ✓    | (try) | —     | —     | —     |
| LP-LB       | ✓    | ✓    | ✓    | ✓     | ✓     | ✓     | ✓     |
| p-SA        | ✓    | ✓    | ✓    | ✓     | ✓     | ✓     | ✓     |
| CEA         | ✓    | ✓    | ✓    | ✓     | ✓     | ✓     | ✓     |

Each stochastic run: 10 replications per (algorithm, problem, objective). Each problem class: 20 instances. Three objectives (EMPTY / DISTANCE / PRICE). Total stochastic runs: ~2 × 7 × 20 × 3 × 10 = 8 400 runs. At average 5 min/run for large, medium for mid, this is ~2 weeks of compute on a desktop, less if you parallelize across machines.

**4.3. Analyses (1 week).**

- Quality vs size: mean RPD from LP_LB (or optimum where available), with error bars, log-scale x-axis.
- Runtime vs size: mean runtime, fit empirical complexity curve.
- Convergence curves: mean trace across replications, separated by objective.
- Reliability histogram: fraction of runs within X% of best-known, generalizing the project's reliability figure.
- Pareto analysis: merge best solutions across all 10 reps × 3 objectives for each instance; compute hypervolume relative to a reference point. Compare p-SA vs CEA Pareto quality.
- Parameter sensitivity: at each scale class, heatmap of quality as function of top two parameters.
- Statistical tests: Wilcoxon signed-rank test between p-SA and CEA on paired (instance, objective, replication) quality results. Report effect sizes, not just p-values.

### Phase 5 — Writing (6 weeks, overlapping with Phase 4)

Thesis outline (numbering approximate):

1. Įvadas — motivation, research question, contributions, structure.
2. Problemos aprašymas — lift and polish from `Kursinis darbas`.
3. Matematinis modelis — full MILP from `Kursinis darbas`, with corrections if Phase 3 surfaces any.
4. Literatūros apžvalga — expanded from `Kursinis darbas`. Add ≥10 recent (2020–2025) VRPPD / pickup-delivery metaheuristics papers.
5. Algoritmai — detailed design of both p-SA and CEA with their problem-specific adaptations.
    - 5.1 p-SA (from project, polished, with Rust implementation details)
    - 5.2 CEA (new)
6. Apatinės ribos — direct-sum and LP-relaxation bounds; validation against exact optima.
7. Eksperimentinis tyrimas — methodology, setup, reproducibility statement.
8. Rezultatai — the analyses from 4.3.
9. Diskusija — when does each algorithm win? Objective sensitivity? Scale sensitivity?
10. Išvados ir tolimesni darbai.
11. Literatūros sąrašas.
12. Priedai — raw result tables, parameter configurations, reproducibility instructions.

Writing pace: chapter per week roughly. Start writing Chapters 1–4 and 7 (methodology) during Phase 2–3 while the code is stabilizing; Chapters 5, 6, 8 after Phase 4 data is in; 9–10 last.

---

## 6. Experimental methodology

**Reproducibility.** Every stochastic run records its seed. Every configuration is version-controlled under `configs/`. Every result file includes the git commit hash. The appendix of the thesis gives exact commands to reproduce each figure.

**Statistical rigor.** Report means with 95% bootstrap CIs. For paired comparisons (p-SA vs CEA on same problem), use Wilcoxon signed-rank; for unpaired, Mann-Whitney U. Always report effect size (Cohen's d or rank-biserial) alongside p-values.

**Quality metric.** At N ≤ 20 where exact or near-exact solutions are available: RPD vs exact. At N > 20: RPD vs LP_LB (acknowledging this inflates apparent RPD due to bound looseness). Also report RPD vs best-known-from-any-algorithm for a "relative" quality view.

**Time budget fairness.** When comparing p-SA vs CEA, give each algorithm the same wall-clock time budget at each scale. Record both "quality at budget expiry" and "time to 1%/5% of best-known" as complementary metrics.

**Objective weighting in EMPTY.** The project's RCRS uses a weighted coefficient for EMPTY's first-leg distance. Document the weight value and test sensitivity (1.0, 1.5, 2.0).

---

## 7. Risks and mitigations

| Risk                                          | Probability    | Impact                    | Mitigation                                                                                                           |
| --------------------------------------------- | -------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CEA is slower AND lower-quality than p-SA     | Medium         | High (weakens comparison) | Report under equal-time and equal-evaluation budgets; frame as "under what conditions" rather than "which is better" |
| LP relaxation bound too loose to be useful    | Medium         | Medium                    | Have fallback: direct-sum bound is always available; document tightness as a thesis finding                          |
| MILP solver integration eats too much time    | Medium         | Medium                    | Use `good_lp` which abstracts over CBC/HiGHS/CPLEX; can swap backend without code changes                            |
| Parameter tuning explodes in time             | High           | Medium                    | Use irace or SMAC instead of grid search; budget explicitly (1 week per scale class max)                             |
| Rust port of p-SA introduces subtle bugs      | Medium         | High                      | Keep NodeJS version as oracle; run parity tests on every commit                                                      |
| Scope creep into other metaheuristics         | Medium         | Medium                    | Hard rule: no new algorithm after month 3. Other metaheuristics go in related-work only                              |
| Large-scale experiments not finishing in time | Medium         | High                      | Start large runs early, in background. Have a "minimum viable result set" defined (e.g., skip N=500 if needed)       |
| Thesis writing deferred until end             | High (classic) | High                      | Write methodology + literature chapters during Phase 2–3, not after                                                  |

---

## 8. Decision points and open questions

Before starting Phase 1, a few things to decide:

1. **Rust migration scope.** Do you port the entire TypeScript harness to Rust, or keep the TS harness and just add Rust solvers it can invoke? Recommendation: keep the harness in Rust (unified runner), move chart generation to Python or keep in TS — they're offline analyses.

2. **MILP solver choice.** CPLEX/Gurobi academic are the best but require license setup. HiGHS is MIT-licensed and reasonable. CBC is slowest but simplest. Recommendation: start with HiGHS via `good_lp`, switch if it's a bottleneck.

3. **Lower bound ambition.** LP relaxation is straightforward. Lagrangian relaxation on the capacity constraints would give tighter bounds but is substantially more work. Recommendation: LP only; mention Lagrangian in future work.

4. **Thesis language.** Lithuanian (matches project precedent) with an English abstract. Confirm with vadovas.

5. **Data release.** Since instance generation is seeded, the generated-problem dataset doesn't need to live in git. But a canonical "benchmark set" (say, 20 instances per scale class with fixed seeds) should be released for reproducibility — either in-repo or as a separate GitHub Release asset.

---

## 9. Immediate next actions (first 2 weeks)

1. Confirm thesis scope with vadovas; get buy-in on Framing A+B.
2. Bootstrap the Cargo workspace in the bachelor's repo.
3. Import `vrppd-brute-force` and `vrppd-core` from KDP-Algoritmai; wire CI.
4. Write the unified result JSON schema and snapshot tests.
5. Start p-SA Rust port while schema is fresh.
6. In parallel: skim 10 recent papers (2022+) on VRPPD metaheuristics for the literature chapter.

---

## 10. Key references (carry-over + additions)

From the coursework:

- [WMZ+15] Wang, C. et al. "A parallel simulated annealing method for the vehicle routing problem with simultaneous pickup-delivery and time windows." _Computers & Industrial Engineering_ 83 (2015).
- [WC13] Wang, H.-F., Chen, Y.-Y. "A coevolutionary algorithm for the flexible delivery and pickup problem with time windows." _International Journal of Production Economics_ 141 (2013).
- [Det01] Dethloff, J. "Vehicle routing and reverse logistics: the vehicle routing problem with simultaneous delivery and pick-up." _OR Spectrum_ 23 (2001).
- [MTZ60] Miller, C.E., Tucker, A.W., Zemlin, R.A. "Integer Programming Formulation of Traveling Salesman Problems." _J. ACM_ 7.4 (1960).
- [TV02] Toth, P., Vigo, D. _The Vehicle Routing Problem._ SIAM, 2002.

Additions to source during Phase 0:

- López-Ibáñez et al. on irace for automated parameter tuning.
- Zitzler & Thiele on hypervolume indicator.
- Recent (2020–2025) VRPPD surveys and modern metaheuristics (ALNS variants for VRPPD, learning-based approaches) — for context, not implementation.
- Vigo's updated _VRP_ 2nd edition (2014) if the original is cited.

---

_This plan is a living document. Updates should be committed alongside major milestones._
