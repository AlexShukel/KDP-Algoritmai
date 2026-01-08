import type { AlgorithmSolution, Location, Problem, ProblemSolution } from 'rust-solver';

export type DistanceCalculator = (from: Location, to: Location) => number;

export interface SimulatedAnnealingConfig {
    initialTemp: number;
    coolingRate: number;
    minTemp: number;
    maxIterations: number;
    batchSize: number; // Iterations per sync
    syncInterval: number; // Batches per sync
    weights?: {
        shift: number;
        swap: number;
        shuffle: number;
    };
}

export interface AlgorithmConfig {
    distanceCalc: DistanceCalculator;
    target: OptimizationTarget;
    saConfig?: Partial<SimulatedAnnealingConfig>; // Optional override
}

export interface Algorithm<T = any> {
    name: string;
    solve: (problem: Problem, config: AlgorithmConfig) => Promise<T>;
    readonly type: 'multi' | 'single';
}

export interface AlgorithmResultWithMetadata<T> {
    solution: T;
    history: ConvergenceUpdate[];
}

export interface MultiTargetAlgorithm extends Algorithm<AlgorithmResultWithMetadata<AlgorithmSolution>> {
    readonly type: 'multi';
}

export const isMultiTarget = (alg: Algorithm): alg is MultiTargetAlgorithm => alg.type === 'multi';

export interface SingleTargetAlgorithm extends Algorithm<AlgorithmResultWithMetadata<ProblemSolution>> {
    readonly type: 'single';
}

export const isSingleTarget = (alg: Algorithm): alg is SingleTargetAlgorithm => alg.type === 'single';

export type SolutionMetrics = Omit<ProblemSolution, 'routes'>;

export interface ConvergenceUpdate {
    timeMs: number;
    iteration: number;
    metrics: SolutionMetrics;
}

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

    convergenceHistory?: ConvergenceUpdate[];

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
