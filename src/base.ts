import { Algorithm, AlgorithmConfig, AlgorithmResult } from './types/algorithm';
import { ProblemInstance, Solution } from './types/problem';

export abstract class BaseAlgorithm implements Algorithm {
    abstract readonly name: string;
    abstract readonly version: string;

    abstract solve(problem: ProblemInstance, config: AlgorithmConfig): Promise<AlgorithmResult>;

    /** Validate problem instance */
    protected validateProblem(problem: ProblemInstance): void {
        if (problem.vehicles.length === 0) {
            throw new Error('Problem must have at least one vehicle');
        }
        if (problem.orders.length === 0) {
            throw new Error('Problem must have at least one order');
        }
        // Add more validation as needed
    }

    /** Generate initial solution using constructive heuristic */
    protected abstract generateInitialSolution(problem: ProblemInstance): Solution;

    /** Check solution feasibility */
    protected validateSolution(solution: Solution, problem: ProblemInstance): boolean {
        // Implement feasibility checks:
        // - Capacity constraints
        // - Time window constraints
        // - Pickup before delivery constraints
        // - Route continuity
        return true; // Placeholder
    }
}
