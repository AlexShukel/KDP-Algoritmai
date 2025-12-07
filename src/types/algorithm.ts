import { Location, Problem, ProblemSolution } from './types';

export type DistanceCalculator = (from: Location, to: Location) => number;

export interface AlgorithmConfig {
    distanceCalc: DistanceCalculator;
}

export type AlgorithmSolution = {
    bestDistanceSolution: ProblemSolution;
    bestPriceSolution: ProblemSolution;
    bestEmptySolution: ProblemSolution;
};

export interface Algorithm {
    name: string;
    solve: (problem: Problem, config: AlgorithmConfig) => AlgorithmSolution;
}
