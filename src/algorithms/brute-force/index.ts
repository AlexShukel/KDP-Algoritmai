/**
 * @module brute-force-solver
 * @description
 * Brute-force VRPPD solver. The implementation lives in the `vrppd-brute-force`
 * Rust crate (memoised bitmask DP with branch-and-bound across all three
 * objectives) and is exposed to the harness through the `napi-bridge` crate.
 * This module is a thin TypeScript adapter that conforms to the harness's
 * `MultiTargetAlgorithm` interface.
 */

import { solveBruteForce } from 'napi-bridge';
import {
    AlgorithmConfig,
    Problem,
    AlgorithmSolution,
    MultiTargetAlgorithm,
    AlgorithmResultWithMetadata,
} from '../../types';

const MAX_PROBLEM_SIZE = 7;

export class BruteForceAlgorithmRust implements MultiTargetAlgorithm {
    type: 'multi' = 'multi';
    name: string = 'brute-force-rust';

    public solve(problem: Problem, config: AlgorithmConfig): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
        if (problem.orders.length > MAX_PROBLEM_SIZE || problem.vehicles.length > MAX_PROBLEM_SIZE) {
            throw new Error(`Problem too large for ${this.name} implementation.`);
        }

        return new Promise(res => res({ solution: solveBruteForce(problem), history: [] }));
    }
}
