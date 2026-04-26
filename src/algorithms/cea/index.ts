/**
 * @module cea-solver
 * @description
 * TS adapter wrapping the Rust Coevolutionary Algorithm (`vrppd-cea` crate,
 * exposed via `napi-bridge::solveCea`). Conforms to the harness's
 * `SingleTargetAlgorithm` interface so it benchmarks side-by-side with the
 * two p-SA implementations.
 *
 * The algorithm mirrors Wang & Chen (2013) §4 with adaptations documented in
 * `documents/CEA_adaptation_notes.md`.
 */

import { solveCea } from 'napi-bridge';
import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    ConvergenceUpdate,
    Problem,
    ProblemSolution,
    SingleTargetAlgorithm,
} from '../../types';

export class CoevolutionaryAlgorithmRust implements SingleTargetAlgorithm {
    type: 'single' = 'single';
    name = 'cea-rust';

    async solve(problem: Problem, config: AlgorithmConfig): Promise<AlgorithmResultWithMetadata<ProblemSolution>> {
        const solved = solveCea(problem, config.target);

        const history: ConvergenceUpdate[] = solved.history.map(p => ({
            timeMs: p.timeMs,
            iteration: p.generation,
            metrics: {
                totalDistance: p.totalDistance,
                emptyDistance: p.emptyDistance,
                totalPrice: p.totalPrice,
            },
        }));

        return { solution: solved.solution, history };
    }
}
