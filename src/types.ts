import type { AlgorithmSolution, Location, Problem } from 'rust-solver';

export type DistanceCalculator = (from: Location, to: Location) => number;

export interface AlgorithmConfig {
    distanceCalc: DistanceCalculator;
}

export interface Algorithm {
    name: string;
    solve: (problem: Problem, config: AlgorithmConfig) => Promise<AlgorithmSolution>;
}

export type BenchmarkResult = {
    problemPath: string;
    execTime: number; // milliseconds
    results: AlgorithmSolution;
    problemSize: {
        vehicles: number;
        orders: number;
    };
};

export enum OptimizationTarget {
    EMPTY,
    DISTANCE,
    PRICE,
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
