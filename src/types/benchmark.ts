import { Algorithm, AlgorithmConfig, AlgorithmResult } from './algorithm';
import { ProblemInstance } from './problem';

/** Individual benchmark run result */
export interface BenchmarkRun {
    readonly algorithmName: string;
    readonly problemId: string;
    readonly result: AlgorithmResult;
    readonly timestamp: number;
    readonly config: AlgorithmConfig;
}

/** Statistical summary of multiple runs */
export interface BenchmarkSummary {
    readonly algorithmName: string;
    readonly problemId: string;
    readonly runs: number;
    readonly avgExecutionTime: number;
    readonly stdExecutionTime: number;
    readonly avgObjectiveValue: number;
    readonly stdObjectiveValue: number;
    readonly bestObjectiveValue: number;
    readonly worstObjectiveValue: number;
    readonly avgIterations: number;
}

/** Benchmark configuration */
export interface BenchmarkConfig {
    readonly runs: number;
    readonly algorithms: ReadonlyArray<Algorithm>;
    readonly problems: ReadonlyArray<ProblemInstance>;
    readonly configs: ReadonlyMap<string, AlgorithmConfig>;
    readonly outputPath?: string;
}

/** Benchmark suite interface */
export interface BenchmarkSuite {
    run(config: BenchmarkConfig): Promise<ReadonlyArray<BenchmarkSummary>>;
    exportResults(summaries: ReadonlyArray<BenchmarkSummary>): Promise<void>;
}
