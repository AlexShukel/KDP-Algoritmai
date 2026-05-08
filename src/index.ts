import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { performance } from 'perf_hooks';
import stringify from 'fast-json-stable-stringify';
import { BruteForceAlgorithmRust } from './algorithms/brute-force';
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
import { ParallelSimulatedAnnealingRust } from './algorithms/p-sa';
import { CoevolutionaryAlgorithmRust } from './algorithms/cea';
import { DirectLowerBound, LpLowerBound } from './algorithms/bounds';
import { MilpExact } from './algorithms/milp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the harness reads instances from. Override by moving directories
// in/out of `problems/` — there is intentionally no scale-class CLI flag
// (BENCHMARKS.md §p-SA parity benchmark §"To run on a subset only").
const PROBLEMS_DIR = 'problems';

// Stochastic algorithms run this many independent replications per
// (instance, target). Defaults to 10 (PLAN.md §4.2 main matrix); override
// to 1–3 for the very large classes (30×100 and bigger) to keep wall-time
// inside the 2026-05-21 freeze (see Projects/Bachelor-VRPPD/benchmark-queue):
//   HEURISTIC_REPETITIONS=3 pnpm start
// The env var is parsed up-front; an unparseable value falls back to 10
// so a typo cannot silently inflate the budget.
const HEURISTIC_REPETITIONS = (() => {
    const raw = process.env.HEURISTIC_REPETITIONS;
    if (!raw) return 10;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        console.warn(`Ignoring invalid HEURISTIC_REPETITIONS="${raw}", using default 10.`);
        return 10;
    }
    return parsed;
})();

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

    // Algorithms registered for the main comparison matrix (PLAN.md §4.2).
    // The order is the run order: cheapest baselines first so that even a
    // cancelled run leaves usable lower-bound and exact-solver rows. The
    // two metaheuristics come last because they dominate the wall-time
    // budget on the large classes (BENCHMARKS.md §"Larger-instance
    // benchmarks" wall-time table).
    //
    // Per-algorithm filtering of which `OptimizationTarget`s are run is
    // declared on the class itself (see `supportedTargets` on each
    // adapter); the loop below honours it. EMPTY is excluded from the
    // bounds + MILP rows because the LP/MILP formulation defines EMPTY
    // as an upper bound on the load-aware empty distance, not a matching
    // quantity (documents/MILP_adaptation_notes.md §2.4).
    const algorithms: Algorithm[] = [
        new BruteForceAlgorithmRust(),
        new DirectLowerBound(),
        new LpLowerBound(),
        new MilpExact(),
        new ParallelSimulatedAnnealingRust(),
        new CoevolutionaryAlgorithmRust(),
    ];

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

            // Skip instances bigger than the algorithm declares it can
            // usefully handle. BF blows up exponentially past N=14, MILP
            // / LP-LB hit solver-scaling cliffs around N=20. Without this
            // guard those algos still get launched per instance and burn
            // the full timeout producing nothing useful (R01's MILP
            // phase spent 24 minutes on 60 s timeouts at N=10..14 alone).
            if (alg.maxProblemSize !== undefined && size.vehicles + size.orders > alg.maxProblemSize) {
                continue;
            }

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
                const reps = alg.repetitions ?? HEURISTIC_REPETITIONS;
                const targets = alg.supportedTargets ?? Object.values(OptimizationTarget);
                for (const target of targets) {
                    for (let i = 0; i < reps; i++) {
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

export { BruteForceAlgorithmRust as BruteForceAlgorithm };
