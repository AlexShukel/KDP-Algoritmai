/**
 * @module bounds
 * @description
 * TS adapters for the two lower bounds shipped from `vrppd-bounds`:
 *
 * - `DirectLowerBound` (multi) — O(N) direct-sum bound; produces all three
 *   objectives in one pass.
 * - `LpLowerBound`     (single) — LP-relaxation bound via good_lp + microlp;
 *   one objective per call.
 *
 * Both adapters are deterministic — `repetitions = 1` so the benchmark
 * harness skips the redundant reruns it normally does for stochastic
 * algorithms. EMPTY is documented as returning the trivial 0 in both
 * (see `documents/MILP_adaptation_notes.md`); the adapters report it
 * verbatim rather than throwing, so downstream tools can still observe
 * the pass-through behaviour.
 *
 * Neither bound produces routes — the adapters fill in a stub
 * `ProblemSolution` with empty `routes` and the bound value plugged
 * into the field matching the requested target. RPD analysis keys on
 * `(target, metric)` so the other two metric fields don't matter.
 */

import { lowerBoundDirect, lowerBoundLp } from 'napi-bridge';
import type { ProblemSolution, AlgorithmSolution } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    MultiTargetAlgorithm,
    OptimizationTarget,
    Problem,
    SingleTargetAlgorithm,
} from '../../types';

function emptyProblemSolution(): ProblemSolution {
    return {
        routes: {},
        totalDistance: 0,
        totalPrice: 0,
        emptyDistance: 0,
    };
}

export class DirectLowerBound implements MultiTargetAlgorithm {
    readonly type = 'multi' as const;
    name = 'lb-direct';

    async solve(
        problem: Problem,
        _config: AlgorithmConfig,
    ): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
        const lb = lowerBoundDirect(problem);

        const bestDistanceSolution: ProblemSolution = { ...emptyProblemSolution(), totalDistance: lb.distance };
        const bestPriceSolution: ProblemSolution = { ...emptyProblemSolution(), totalPrice: lb.price };
        // EMPTY's direct-sum bound is 0 by construction; pass through verbatim.
        const bestEmptySolution: ProblemSolution = { ...emptyProblemSolution(), emptyDistance: lb.empty };

        return {
            solution: { bestDistanceSolution, bestPriceSolution, bestEmptySolution },
            history: [],
        };
    }
}

export class LpLowerBound implements SingleTargetAlgorithm {
    readonly type = 'single' as const;
    readonly repetitions = 1;
    name = 'lb-lp';

    async solve(
        problem: Problem,
        config: AlgorithmConfig,
    ): Promise<AlgorithmResultWithMetadata<ProblemSolution>> {
        const value = lowerBoundLp(problem, config.target);
        const solution: ProblemSolution = emptyProblemSolution();
        switch (config.target) {
            case OptimizationTarget.DISTANCE:
                solution.totalDistance = value;
                break;
            case OptimizationTarget.PRICE:
                solution.totalPrice = value;
                break;
            case OptimizationTarget.EMPTY:
                solution.emptyDistance = value;
                break;
        }
        return { solution, history: [] };
    }
}
