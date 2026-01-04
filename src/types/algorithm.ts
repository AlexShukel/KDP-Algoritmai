import { AlgorithmSolution, Location, Problem } from './types';

export type DistanceCalculator = (from: Location, to: Location) => number;

export interface AlgorithmConfig {
    distanceCalc: DistanceCalculator;
}

export interface Algorithm {
    name: string;
    solve: (problem: Problem, config: AlgorithmConfig) => AlgorithmSolution;
}
