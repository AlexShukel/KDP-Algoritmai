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

// Hard upper bound on `vehicles + orders` (PLAN.md §4.2 has BF only at
// N=10 and N=14). The Rust crate's `PathBuffer` is `[u8; 16]` which by
// itself caps the order count at 8 (each order = 2 nodes); 14 is the
// joint cap that keeps the outer enumeration tractable.
const MAX_V_PLUS_O = 14;

export class BruteForceAlgorithmRust implements MultiTargetAlgorithm {
    readonly type = 'multi' as const;
    readonly maxProblemSize = MAX_V_PLUS_O;
    name: string = 'brute-force-rust';

    public solve(problem: Problem, config: AlgorithmConfig): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
        return new Promise(res => res({ solution: solveBruteForce(problem), history: [] }));
    }
}
