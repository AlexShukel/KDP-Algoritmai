import { ProblemInstance, Solution, Location } from '../types/problem';

/** Constructive heuristic for generating initial solutions */
export interface ConstructiveHeuristic {
    readonly name: string;
    generate(problem: ProblemInstance): Solution;
}

/** Local search operator for solution improvement */
export interface LocalSearchOperator {
    readonly name: string;
    apply(solution: Solution, problem: ProblemInstance): Solution | null;
}

/** Crossover operator for genetic algorithms */
export interface CrossoverOperator {
    readonly name: string;
    cross(parent1: Solution, parent2: Solution, problem: ProblemInstance): [Solution, Solution];
}

/** Mutation operator for genetic algorithms */
export interface MutationOperator {
    readonly name: string;
    mutate(solution: Solution, problem: ProblemInstance): Solution;
}

/** Selection operator for evolutionary algorithms */
export interface SelectionOperator {
    readonly name: string;
    select(population: ReadonlyArray<Solution>, count: number): ReadonlyArray<Solution>;
}

/** Distance calculation utility */
export interface DistanceCalculator {
    calculate(from: Location, to: Location): number;
}

/** Random number generator interface for reproducible results */
export interface RandomGenerator {
    next(): number; // [0, 1)
    nextInt(max: number): number; // [0, max)
    nextGaussian(): number;
    seed(value: number): void;
}
