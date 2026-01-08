import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { performance } from 'perf_hooks';
import stringify from 'fast-json-stable-stringify';
import { BruteForceAlgorithmJS, BruteForceAlgorithmRust } from './algorithms/brute-force';
import {
    Problem,
    Algorithm,
    OptimizationTarget,
    isMultiTarget,
    isSingleTarget,
    ProblemSolution,
    SolutionMetrics,
    BenchmarkRecord,
    ConvergenceUpdate,
} from './types';
import { greatCircleDistanceCalculator } from './utils/greatCircleDistanceCalculator';
import { ParallelSimulatedAnnealing } from './algorithms/p-sa';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROBLEMS_DIR = 'problems';
const HEURISTIC_REPETITIONS = 10;

function sampleHistory(history: ConvergenceUpdate[], maxPoints = 100): ConvergenceUpdate[] {
    if (history.length <= maxPoints) {
        return history;
    }
    const factor = Math.ceil(history.length / maxPoints);
    return history.filter((_, i) => i % factor === 0 || i === history.length - 1);
}

async function main(): Promise<void> {
    const problemFiles = glob.sync('**/*.json', { cwd: PROBLEMS_DIR, absolute: true });

    if (problemFiles.length === 0) {
        console.error('No problem files found.');
        process.exit(1);
    }

    // Sort by complexity (vehicles + orders)
    problemFiles.sort((a, b) => {
        const regex = /[\\/](\d+)_(\d+)[\\/]/;
        const matchA = a.match(regex);
        const matchB = b.match(regex);
        if (!matchA || !matchB) {
            return 0;
        }
        return parseInt(matchA[1]) + parseInt(matchA[2]) - (parseInt(matchB[1]) + parseInt(matchB[2]));
    });

    // Register algorithms
    const algorithms: Algorithm[] = [new BruteForceAlgorithmRust(), new ParallelSimulatedAnnealing()];

    const extractMetrics = (solution: ProblemSolution): SolutionMetrics => ({
        totalDistance: solution.totalDistance,
        totalPrice: solution.totalPrice,
        emptyDistance: solution.emptyDistance,
    });

    for (const alg of algorithms) {
        console.log(`\n========================================`);
        console.log(`Starting benchmark for: ${alg.name}`);
        console.log(`========================================`);

        const benchmarkRecords: BenchmarkRecord[] = [];

        for (let i = 0; i < problemFiles.length; ++i) {
            const filePath = problemFiles[i];
            const relativePath = path.relative(process.cwd(), filePath);

            const raw = fs.readFileSync(filePath, 'utf-8');
            const problem: Problem = JSON.parse(raw);
            const size = { vehicles: problem.vehicles.length, orders: problem.orders.length };

            console.log(`Processing ${relativePath}`);

            if (isMultiTarget(alg)) {
                const start = performance.now();

                try {
                    const { solution } = await alg.solve(problem, {
                        distanceCalc: greatCircleDistanceCalculator,
                        target: OptimizationTarget.DISTANCE, // ignored
                    });

                    const duration = performance.now() - start;

                    const targets: Array<{ t: OptimizationTarget; s: ProblemSolution }> = [
                        { t: OptimizationTarget.DISTANCE, s: solution.bestDistanceSolution },
                        { t: OptimizationTarget.PRICE, s: solution.bestPriceSolution },
                        { t: OptimizationTarget.EMPTY, s: solution.bestEmptySolution },
                    ];

                    targets.forEach(({ t, s }) => {
                        benchmarkRecords.push({
                            problemPath: relativePath,
                            problemSize: size,
                            optimizationTarget: t,
                            runIndex: 0,
                            execTime: duration,
                            metrics: extractMetrics(s),
                            isBatchResult: true,
                        });
                    });
                } catch (err) {
                    console.error(`Error solving ${relativePath}:`, err);
                }
            } else if (isSingleTarget(alg)) {
                for (const target of Object.values(OptimizationTarget)) {
                    for (let i = 0; i < HEURISTIC_REPETITIONS; i++) {
                        const start = performance.now();
                        try {
                            const { history, solution } = await alg.solve(problem, {
                                distanceCalc: greatCircleDistanceCalculator,
                                target,
                            });
                            const duration = performance.now() - start;

                            benchmarkRecords.push({
                                problemPath: relativePath,
                                problemSize: size,
                                optimizationTarget: target,
                                runIndex: i,
                                execTime: duration,
                                metrics: extractMetrics(solution),
                                isBatchResult: false,
                                convergenceHistory: sampleHistory(history),
                            });
                        } catch (err) {
                            console.error(`Error solving ${relativePath} on run ${i}, target ${target}:`, err);
                        }
                    }
                }
            }
        }

        const outputFilename = `benchmark-results-${alg.name}.json`;
        const outputPath = path.resolve(__dirname, outputFilename);
        fs.writeFileSync(outputPath, stringify(benchmarkRecords));
        console.log(`Saved ${benchmarkRecords.length} records to ${outputFilename}`);
    }
}

main().catch(error => {
    console.error('\nBenchmark suite failed:', error.message);

    if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
    }

    process.exit(1);
});

export { BruteForceAlgorithmJS as BruteForceAlgorithm };
