/**
 * @module milp-solver
 * @description
 * TS adapter wrapping the bundled HiGHS MILP solver (`vrppd-milp` crate,
 * exposed via `napi-bridge::solveMilp`). Conforms to the harness's
 * `SingleTargetAlgorithm` interface; deterministic so `repetitions = 1`.
 *
 * EMPTY is rejected at the napi layer because the §2.4 MILP formula
 * doesn't match the implementation's load-aware EMPTY (see
 * `documents/MILP_adaptation_notes.md`). The adapter rethrows so the
 * harness's existing try/catch logs and continues.
 *
 * The adapter accepts a per-instance wall-clock timeout; the default
 * matches PLAN.md §3.3 (30 minutes) and the Rust crate's
 * `DEFAULT_TIMEOUT`. Earlier R01 smoke runs used a tighter 60 s cap
 * which produced ~24 timeouts at N=10..14 (most of the bank's upper
 * tier); the 30 min default lets the comparison matrix surface
 * provably-optimal numbers where HiGHS can find them. Callers running
 * a fast smoke benchmark can shorten this via the constructor.
 *
 * The adapter also declares `maxProblemSize = 20`: PLAN.md §4.2 has
 * MILP only at N ∈ {10, 14, 20} with "(try) at N=50". In practice
 * every N>20 instance times out without producing a useful primal
 * incumbent and just wastes the 30 min budget; the harness skips them.
 */

import { solveMilp } from 'napi-bridge';
import type { ProblemSolution } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    OptimizationTarget,
    Problem,
    SingleTargetAlgorithm,
} from '../../types';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;

export class MilpExact implements SingleTargetAlgorithm {
    readonly type = 'single' as const;
    readonly repetitions = 1;
    readonly supportedTargets = [OptimizationTarget.DISTANCE, OptimizationTarget.PRICE] as const;
    readonly maxProblemSize = 20;
    name = 'milp-rust';

    constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

    async solve(
        problem: Problem,
        config: AlgorithmConfig,
    ): Promise<AlgorithmResultWithMetadata<ProblemSolution>> {
        const result = solveMilp(problem, config.target, { timeoutMs: this.timeoutMs });

        const solution: ProblemSolution = {
            routes: {},
            totalDistance: 0,
            totalPrice: 0,
            emptyDistance: 0,
        };
        switch (config.target) {
            case OptimizationTarget.DISTANCE:
                solution.totalDistance = result.value;
                break;
            case OptimizationTarget.PRICE:
                solution.totalPrice = result.value;
                break;
            case OptimizationTarget.EMPTY:
                solution.emptyDistance = result.value;
                break;
        }
        // The TIMEDOUT status is intentionally not surfaced through the
        // harness's BenchmarkRecord shape — the harness records `value`
        // and `execTime` already, and the thesis is interested in
        // proven-optimal numbers (which is what TIMEDOUT runs are not).
        // Loud logging keeps the asymmetry visible during runs.
        if (result.status !== 'OPTIMAL') {
            console.warn(
                `milp-rust: timed out on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                    `target=${config.target} after ${this.timeoutMs}ms — recording best primal incumbent`,
            );
        }
        return { solution, history: [] };
    }
}
