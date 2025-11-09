import { writeFile } from 'fs/promises';

import { AlgorithmResult } from '../types/algorithm';
import { BenchmarkSuite, BenchmarkConfig, BenchmarkSummary, BenchmarkRun } from '../types/benchmark';

/** Main benchmarking implementation */
export class DefaultBenchmarkSuite implements BenchmarkSuite {
    async run(config: BenchmarkConfig): Promise<ReadonlyArray<BenchmarkSummary>> {
        const results: BenchmarkRun[] = [];

        for (const algorithm of config.algorithms) {
            for (const problem of config.problems) {
                const algorithmConfig = config.configs.get(algorithm.name) || {
                    maxIterations: 1000,
                    timeLimit: 1 * 60 * 1000, // 1 minute
                    goal: 'emptyDistance',
                };

                console.log(
                    `Running ${algorithm.name} on problem ${problem.vehicles.length}v${problem.orders.length}o`,
                );

                const runs: AlgorithmResult[] = [];
                for (let run = 0; run < config.runs; run++) {
                    const result = await algorithm.solve(problem, {
                        ...algorithmConfig,
                        randomSeed: run, // Ensure reproducible different runs
                        goal: 'emptyDistance',
                    });

                    runs.push(result);
                    results.push({
                        algorithmName: algorithm.name,
                        problemId: `${problem.vehicles.length}v${problem.orders.length}o`,
                        result,
                        timestamp: Date.now(),
                        config: algorithmConfig,
                    });
                }
            }
        }

        return this.summarizeResults(results);
    }

    private summarizeResults(results: ReadonlyArray<BenchmarkRun>): ReadonlyArray<BenchmarkSummary> {
        const grouped = new Map<string, BenchmarkRun[]>();

        for (const result of results) {
            const key = `${result.algorithmName}:${result.problemId}`;
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key)!.push(result);
        }

        return Array.from(grouped.entries()).map(([key, runs]) => {
            const [algorithmName, problemId] = key.split(':');
            const objectives = runs.map(r => r.result.solution.emptyDistance);
            const times = runs.map(r => r.result.executionTime);

            return {
                algorithmName,
                problemId,
                runs: runs.length,
                avgExecutionTime: this.average(times),
                stdExecutionTime: this.std(times),
                avgObjectiveValue: this.average(objectives),
                stdObjectiveValue: this.std(objectives),
                bestObjectiveValue: Math.min(...objectives),
                worstObjectiveValue: Math.max(...objectives),
                avgIterations: this.average(runs.map(r => r.result.iterations)),
            };
        });
    }

    private average(values: ReadonlyArray<number>): number {
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }

    private std(values: ReadonlyArray<number>): number {
        const avg = this.average(values);
        const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    async exportResults(summaries: ReadonlyArray<BenchmarkSummary>): Promise<void> {
        try {
            await writeFile('bench_results.json', JSON.stringify(summaries, null, 4));
        } catch (error) {
            console.error('Failed to export benchmark results');
        }
    }
}
