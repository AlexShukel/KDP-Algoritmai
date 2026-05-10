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
        // Params locked from R03 tuning sweep (mean gap 3.9994%, avg runtime ~2.8 s/call at N=14).
        const solved = solveCea(problem, config.target, {
            populationSize: 200,
            convCount: 300,
            pCrossover: 0.7,
            pReinsertion: 0.3,
            wallTimeCapMs: 60_000,
        });

        if (solved.exitReason === 'wall_time_cap') {
            console.warn(
                `[cea] wall-time cap hit after ${solved.generations} generations (conv_count=300 not reached)`,
            );
        }

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
