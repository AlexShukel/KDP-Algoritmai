import type { AlgorithmSolution, Location, Problem, ProblemSolution } from 'rust-solver';

export type DistanceCalculator = (from: Location, to: Location) => number;

export interface AlgorithmConfig {
    distanceCalc: DistanceCalculator;
    target: OptimizationTarget;
}

export interface Algorithm<T = any> {
    name: string;
    solve: (problem: Problem, config: AlgorithmConfig) => Promise<T>;
    readonly type: 'multi' | 'single';
}

export interface MultiTargetAlgorithm extends Algorithm<AlgorithmSolution> {
    readonly type: 'multi';
}

export const isMultiTarget = (alg: Algorithm): alg is MultiTargetAlgorithm => alg.type === 'multi';

export interface SingleTargetAlgorithm extends Algorithm<ProblemSolution> {
    readonly type: 'single';
}

export const isSingleTarget = (alg: Algorithm): alg is SingleTargetAlgorithm => alg.type === 'single';

export type SolutionMetrics = Omit<ProblemSolution, 'routes'>;

export type BenchmarkRecord = {
    problemPath: string;
    problemSize: {
        vehicles: number;
        orders: number;
    };
    optimizationTarget: OptimizationTarget;
    runIndex: number;
    execTime: number; // ms
    metrics: SolutionMetrics;

    isBatchResult: boolean;
};

export enum OptimizationTarget {
    EMPTY = 'EMPTY',
    DISTANCE = 'DISTANCE',
    PRICE = 'PRICE',
}

export type {
    Location,
    Vehicle,
    Order,
    Problem,
    ProblemSolution,
    VehicleRoute,
    AlgorithmSolution,
    RouteStop,
} from 'rust-solver';
