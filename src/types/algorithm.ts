import { Location, Problem, ProblemSolution } from './types';

type OptimizationGoal = 'emptyDistance' | 'totalDistance' | 'totalPrice';
export type DistanceCalculator = (from: Location, to: Location) => number;

export interface AlgorithmConfig {
    maxIterations: number;
    goal: OptimizationGoal;
    distanceCalc: DistanceCalculator;
}

export interface Algorithm {
    name: string;
    solve: (problem: Problem, config: AlgorithmConfig) => ProblemSolution;
}
