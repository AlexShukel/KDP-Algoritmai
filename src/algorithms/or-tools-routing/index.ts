/**
 * @module or-tools-routing
 * @description
 * TS adapter wrapping vrppd-or-tools' Routing Solver. Solves DISTANCE and
 * PRICE sequentially per problem; EMPTY is unsupported. Routing returns
 * near-optimal solutions — `FEASIBLE` is its normal success state, so we
 * warn only on `TIMEDOUT` (no incumbent found in budget).
 */

import { solveOrToolsRouting } from 'napi-bridge';
import type { AlgorithmSolution, OrToolsResultWire, ProblemSolution } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    MultiTargetAlgorithm,
    OptimizationTarget,
    Problem,
} from '../../types';

const DEFAULT_TIMEOUT_MS = 60_000;

const EMPTY_SOLUTION: ProblemSolution = {
    routes: {},
    totalDistance: 0,
    totalPrice: 0,
    emptyDistance: 0,
};

export class OrToolsRouting implements MultiTargetAlgorithm {
    readonly type = 'multi' as const;
    name = 'or-tools-routing';
    readonly supportedTargets = [OptimizationTarget.DISTANCE, OptimizationTarget.PRICE] as const;

    constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

    async solve(
        problem: Problem,
        _config: AlgorithmConfig,
    ): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
        const dist = solveOrToolsRouting(problem, OptimizationTarget.DISTANCE, {
            timeoutMs: this.timeoutMs,
        });
        const price = solveOrToolsRouting(problem, OptimizationTarget.PRICE, {
            timeoutMs: this.timeoutMs,
        });

        warnIfTimedOut('or-tools-routing', problem, 'DISTANCE', dist, this.timeoutMs);
        warnIfTimedOut('or-tools-routing', problem, 'PRICE', price, this.timeoutMs);

        return {
            solution: {
                bestDistanceSolution: { ...EMPTY_SOLUTION, totalDistance: dist.value },
                bestPriceSolution: { ...EMPTY_SOLUTION, totalPrice: price.value },
                bestEmptySolution: EMPTY_SOLUTION,
            },
            history: [],
        };
    }
}

function warnIfTimedOut(
    name: string,
    problem: Problem,
    target: string,
    r: OrToolsResultWire,
    timeoutMs: number,
) {
    if (r.status === 'TIMEDOUT') {
        console.warn(
            `${name}: TIMEDOUT on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                `target=${target} after ${timeoutMs}ms — no incumbent found`,
        );
    }
}
