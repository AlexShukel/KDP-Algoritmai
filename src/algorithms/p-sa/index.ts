// p-SA TS adapter for the harness.
//
// History (2026-05-07): the original TypeScript p-SA implementation
// (`ParallelSimulatedAnnealing`, with Worker-thread island model and an
// in-TS RCRS) was retired together with `p-sa.worker.ts` and `rcrs.ts`.
// The Rust port in `crates/vrppd-psa` (exposed via napi-bridge as
// `solvePSa`) had reached parity per `reports/psa-port-report.md`, so
// the TS oracle was no longer needed and a single source of truth is
// preferable for the thesis (PLAN.md §1.1, §4 Rust runner direction).
//
// What remains here is just the *adapter* that lets the Rust solver
// participate in the TS harness as a `SingleTargetAlgorithm`.

import { solvePSa } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    ConvergenceUpdate,
    Problem,
    ProblemSolution,
    SingleTargetAlgorithm,
} from '../../types';

/**
 * Adapter wrapping the Rust multi-thread p-SA pipeline (`vrppd-psa`
 * crate, exposed via `napi-bridge::solvePSa`). Conforms to the
 * harness's `SingleTargetAlgorithm` interface so it can be benchmarked
 * alongside CEA, MILP, the lower bounds, and Brute Force.
 *
 * The adapter is intentionally thin: all algorithmic logic (RCRS
 * initial solution, Shift / Lazy Swap / Intra-Shuffle operators, island
 * model + re-heating) lives in Rust. This class only translates between
 * the harness's `AlgorithmConfig` shape and the napi binding's flat
 * config object, then re-shapes the convergence trace into the
 * harness's `ConvergenceUpdate[]`.
 */
export class ParallelSimulatedAnnealingRust implements SingleTargetAlgorithm {
    type: 'single' = 'single';
    name = 'p-sa-rust';

    async solve(problem: Problem, config: AlgorithmConfig): Promise<AlgorithmResultWithMetadata<ProblemSolution>> {
        const sa = config.saConfig ?? {};

        // Params locked from R02 162×3 tuning sweep (avg gap 1.122%, ~8.6 ms/rep at N=14).
        // The napi binding is *flat* — operator weights are passed as
        // separate top-level fields rather than as a nested `weights`
        // object — so we hand-roll the mapping here. Keep this list in
        // sync with `napi-bridge`'s `PsaConfig` struct.
        const solved = solvePSa(problem, config.target, {
            initialTemp: sa.initialTemp ?? 1500,
            coolingRate: sa.coolingRate ?? 0.999,
            minTemp: sa.minTemp,
            maxIterations: sa.maxIterations ?? 10000,
            batchSize: sa.batchSize ?? 200,
            syncInterval: sa.syncInterval ?? 10,
            weightShift: sa.weights?.shift,
            weightSwap: sa.weights?.swap,
            weightShuffle: sa.weights?.shuffle,
        });

        // Rust returns the convergence trace as flat records (one row
        // per sampled iteration). The harness expects nested metrics,
        // so re-shape here. Sampling-down to ~100 points is the
        // harness's job (see `sampleHistory` in `src/index.ts`).
        const history: ConvergenceUpdate[] = solved.history.map(p => ({
            timeMs: p.timeMs,
            iteration: p.iteration,
            metrics: {
                totalDistance: p.totalDistance,
                emptyDistance: p.emptyDistance,
                totalPrice: p.totalPrice,
            },
        }));

        return { solution: solved.solution, history };
    }
}
