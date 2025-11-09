import { DistanceCalculator } from '../algorithms/interfaces';
import { ProblemInstance, Solution } from './problem';

/** Algorithm execution result */
export interface AlgorithmResult {
    readonly solution: Solution;
    readonly executionTime: number; // ms
    readonly iterations: number;
    readonly convergenceData?: ReadonlyArray<number>; // Objective values over time
}

/** Algorithm configuration parameters */
export interface AlgorithmConfig {
    readonly maxIterations: number;
    readonly timeLimit: number; // ms
    readonly goal: 'emptyDistance' | 'totalDistance';
    distanceCalc?: DistanceCalculator; // GreatCircleDistanceCalculator by default
    readonly randomSeed?: number;
    readonly verbose?: boolean;
}

/** Base algorithm interface */
export interface Algorithm {
    readonly name: string;
    readonly version: string;
    solve(problem: ProblemInstance, config: AlgorithmConfig): Promise<AlgorithmResult>;
}

/** Metaheuristic-specific configuration */
export interface MetaheuristicConfig extends AlgorithmConfig {
    readonly populationSize?: number;
    readonly crossoverRate?: number;
    readonly mutationRate?: number;
    readonly selectionPressure?: number;
}

/** Simulated Annealing specific configuration */
export interface SAConfig extends AlgorithmConfig {
    readonly initialTemperature: number;
    readonly coolingRate: number;
    readonly minTemperature: number;
    readonly iterationsPerTemperature: number;
}

/** Parallel Simulated Annealing configuration */
export interface ParallelSAConfig extends SAConfig {
    readonly numThreads: number;
    readonly exchangeInterval: number;
    readonly masterSlaveRatio?: number;
}

/** Coevolutionary Algorithm configuration */
export interface CoevolutionaryConfig extends MetaheuristicConfig {
    readonly population1Size: number;
    readonly population2Size: number;
    readonly exchangeRate: number;
    readonly diversificationWeight: number;
    readonly intensificationWeight: number;
}
