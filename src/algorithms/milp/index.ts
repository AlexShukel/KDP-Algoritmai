/**
 * @module milp-solver
 * @description
 * TS adapter wrapping the bundled HiGHS MILP solver (`vrppd-milp` crate,
 * exposed via `napi-bridge::solveMilpBoth`). Conforms to the harness's
 * `MultiTargetAlgorithm` interface so DISTANCE and PRICE are solved
 * concurrently on two OS threads, each using HiGHS's internal multi-thread
 * B&B.
 *
 * EMPTY is not supported by the MILP formulation (§2.4 mismatch — see
 * `documents/MILP_adaptation_notes.md`). The harness records zeros for the
 * EMPTY slot; the thesis only uses MILP rows for DISTANCE and PRICE.
 *
 * The adapter accepts a per-instance wall-clock timeout; the default
 * here is **deliberately tight (60 s)** for the benchmark harness, well
 * under PLAN.md §3.3's 30-min ceiling. Callers running a one-off
 * thesis-grade MILP sweep should pass a longer timeout via the
 * constructor.
 */

import { solveMilpBoth } from 'napi-bridge';
import type { AlgorithmSolution, ProblemSolution } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    MultiTargetAlgorithm,
    Problem,
} from '../../types';

const DEFAULT_TIMEOUT_MS = 60_000;

const EMPTY_SOLUTION: ProblemSolution = {
    routes: {},
    totalDistance: 0,
    totalPrice: 0,
    emptyDistance: 0,
};

export class MilpExact implements MultiTargetAlgorithm {
    readonly type = 'multi' as const;
    name = 'milp-rust';

    constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

    async solve(
        problem: Problem,
        _config: AlgorithmConfig,
    ): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
        const result = solveMilpBoth(problem, { timeoutMs: this.timeoutMs });

        if (result.distance.status !== 'OPTIMAL') {
            console.warn(
                `milp-rust: timed out on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                    `target=DISTANCE after ${this.timeoutMs}ms — recording best primal incumbent`,
            );
        }
        if (result.price.status !== 'OPTIMAL') {
            console.warn(
                `milp-rust: timed out on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                    `target=PRICE after ${this.timeoutMs}ms — recording best primal incumbent`,
            );
        }

        const solution: AlgorithmSolution = {
            bestDistanceSolution: { ...EMPTY_SOLUTION, totalDistance: result.distance.value },
            bestPriceSolution: { ...EMPTY_SOLUTION, totalPrice: result.price.value },
            bestEmptySolution: EMPTY_SOLUTION,
        };

        return { solution, history: [] };
    }
}
