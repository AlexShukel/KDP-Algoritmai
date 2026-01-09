// tune-psa.ts
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { performance } from 'perf_hooks';
import { OptimizationTarget, Problem, SimulatedAnnealingConfig, ProblemSolution } from './src/types';
import { ParallelSimulatedAnnealing } from './src/algorithms/p-sa';
import { BruteForceAlgorithmRust } from './src/algorithms/brute-force';
import { greatCircleDistanceCalculator } from './src/utils/greatCircleDistanceCalculator';

const PROBLEMS_DIR = 'problems';
const MAX_PROBLEM_SIZE_FOR_TUNING = 7; // Only tune on problems where we can compute GT
const REPETITIONS_PER_CONFIG = 5; // SA is stochastic, average the runs

// 1. DEFINING THE HYPERPARAMETER GRID
const paramGrid: Partial<SimulatedAnnealingConfig>[] = [];

const temps = [500, 1500, 5000];
const coolingRates = [0.95, 0.99, 0.999];
const maxIters = [5000, 20000];

temps.forEach(temp => {
    coolingRates.forEach(cool => {
        maxIters.forEach(iter => {
            paramGrid.push({
                initialTemp: temp,
                coolingRate: cool,
                maxIterations: iter,
                // Keep batch/sync constant for now or add to grid
                batchSize: 50,
                syncInterval: 10,
            });
        });
    });
});

interface TuningResult {
    configId: number;
    config: Partial<SimulatedAnnealingConfig>;
    target: OptimizationTarget;
    avgGapPercent: number; // How far from optimal?
    avgTimeMs: number;
}

async function main() {
    // 1. Load Validation Set (Small problems)
    const allFiles = glob.sync('**/*.json', { cwd: PROBLEMS_DIR, absolute: true });
    const validationFiles = allFiles
        .filter(f => {
            const match = f.match(/(\d+)_(\d+)/);
            if (!match) return false;
            const size = parseInt(match[1]) + parseInt(match[2]);
            return size <= MAX_PROBLEM_SIZE_FOR_TUNING;
        })
        .slice(0, 5); // Take 5 random small problems to save time, or all if feasible

    console.log(`Tuning on ${validationFiles.length} validation problems with ${paramGrid.length} configs...`);

    const bf = new BruteForceAlgorithmRust();
    const psa = new ParallelSimulatedAnnealing();
    const results: TuningResult[] = [];

    // Pre-calculate Ground Truth (Brute Force)
    const groundTruth = new Map<string, Record<OptimizationTarget, number>>();

    console.log('Calculating Ground Truths...');
    for (const file of validationFiles) {
        const problem: Problem = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const gt: Record<string, number> = {};

        // Assuming Brute Force returns result for all targets
        // Note: You might need to adjust based on your actual BF API
        const res = await bf.solve(problem, {
            distanceCalc: greatCircleDistanceCalculator,
            target: OptimizationTarget.DISTANCE,
        });
        for (const t of Object.values(OptimizationTarget)) {
            // Extract the specific metric value
            const val = extractMetric(
                t === OptimizationTarget.DISTANCE
                    ? res.solution.bestDistanceSolution
                    : t === OptimizationTarget.EMPTY
                      ? res.solution.bestEmptySolution
                      : res.solution.bestPriceSolution,
                t,
            );
            gt[t] = val;
        }
        groundTruth.set(file, gt as any);
    }

    // 2. Run Grid Search
    for (let cIdx = 0; cIdx < paramGrid.length; cIdx++) {
        const config = paramGrid[cIdx];
        console.log(`Testing Config ${cIdx + 1}/${paramGrid.length}:`, config);

        for (const target of Object.values(OptimizationTarget)) {
            let totalGap = 0;
            let totalTime = 0;

            for (const file of validationFiles) {
                const problem: Problem = JSON.parse(fs.readFileSync(file, 'utf-8'));
                const optimalVal = groundTruth.get(file)![target];

                let fileSumVal = 0;

                for (let r = 0; r < REPETITIONS_PER_CONFIG; r++) {
                    const start = performance.now();
                    const res = await psa.solve(problem, {
                        distanceCalc: greatCircleDistanceCalculator,
                        target: target,
                        saConfig: config,
                    });
                    totalTime += performance.now() - start;

                    const val = extractMetric(res.solution, target);
                    fileSumVal += val;
                }

                const avgVal = fileSumVal / REPETITIONS_PER_CONFIG;
                // Calculate percentage deviation from optimal
                const gap = ((avgVal - optimalVal) / optimalVal) * 100;
                totalGap += gap;
            }

            results.push({
                configId: cIdx,
                config,
                target,
                avgGapPercent: totalGap / validationFiles.length,
                avgTimeMs: totalTime / (validationFiles.length * REPETITIONS_PER_CONFIG),
            });
        }
    }

    // 3. Save and Log Results
    fs.writeFileSync('tuning-results.json', JSON.stringify(results, null, 2));

    console.log('\n--- BEST CONFIGURATIONS ---');
    Object.values(OptimizationTarget).forEach(t => {
        const best = results.filter(r => r.target === t).sort((a, b) => a.avgGapPercent - b.avgGapPercent)[0];

        console.log(`\nTarget: ${t}`);
        console.log(`Gap: ${best.avgGapPercent.toFixed(4)}% | Time: ${best.avgTimeMs.toFixed(0)}ms`);
        console.log(`Config:`, best.config);
    });
}

function extractMetric(sol: ProblemSolution, t: OptimizationTarget): number {
    switch (t) {
        case OptimizationTarget.DISTANCE:
            return sol.totalDistance;
        case OptimizationTarget.PRICE:
            return sol.totalPrice;
        case OptimizationTarget.EMPTY:
            return sol.emptyDistance;
    }
}

main();
