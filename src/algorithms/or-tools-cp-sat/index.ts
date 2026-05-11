/**
 * @module or-tools-cp-sat
 * @description
 * TS adapter wrapping vrppd-or-tools' CP-SAT solver. Solves DISTANCE and PRICE
 * sequentially per problem; EMPTY is unsupported (mirrors vrppd-milp).
 *
 * The crate's default timeout is 30 minutes; the harness default here is
 * deliberately tight (60s) to keep R05 wall-time bounded. Callers running a
 * thesis-grade sweep can pass a longer timeout via the constructor.
 */

import { solveOrToolsCpSat } from 'napi-bridge';
import type { AlgorithmSolution, OrToolsResultWire } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    MultiTargetAlgorithm,
    OptimizationTarget,
    Problem,
} from '../../types';

const DEFAULT_TIMEOUT_MS = 60_000;

const EMPTY_SOLUTION = {
    routes: {},
    totalDistance: 0,
    totalPrice: 0,
    emptyDistance: 0,
};

export class OrToolsCpSat implements MultiTargetAlgorithm {
    readonly type = 'multi' as const;
    name = 'or-tools-cp-sat';
    readonly supportedTargets = [OptimizationTarget.DISTANCE, OptimizationTarget.PRICE] as const;

    constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

    async solve(
        problem: Problem,
        _config: AlgorithmConfig,
    ): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
        const dist = solveOrToolsCpSat(problem, OptimizationTarget.DISTANCE, {
            timeoutMs: this.timeoutMs,
        });
        const price = solveOrToolsCpSat(problem, OptimizationTarget.PRICE, {
            timeoutMs: this.timeoutMs,
        });

        warnIfNotOptimal('or-tools-cp-sat', problem, 'DISTANCE', dist, this.timeoutMs);
        warnIfNotOptimal('or-tools-cp-sat', problem, 'PRICE', price, this.timeoutMs);

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

function warnIfNotOptimal(
    name: string,
    problem: Problem,
    target: string,
    r: OrToolsResultWire,
    timeoutMs: number,
) {
    // CP-SAT: warn whenever optimality wasn't proven.
    if (r.status !== 'OPTIMAL') {
        console.warn(
            `${name}: ${r.status} on ${problem.vehicles.length}v×${problem.orders.length}o ` +
                `target=${target} after ${timeoutMs}ms — recording best incumbent`,
        );
    }
}
