import fs from 'fs';
import { glob } from 'glob';
import { performance } from 'perf_hooks';
import { OptimizationTarget, Problem, SimulatedAnnealingConfig, ProblemSolution } from './types';
import { ParallelSimulatedAnnealing } from './algorithms/p-sa';
import { BruteForceAlgorithmRust } from './algorithms/brute-force';
import { greatCircleDistanceCalculator } from './utils/greatCircleDistanceCalculator';

const PROBLEMS_DIR = 'problems';
const MAX_PROBLEM_SIZE_FOR_TUNING = 14;
const REPETITIONS_PER_CONFIG = 5;

const paramGrid: Partial<SimulatedAnnealingConfig>[] = [];

const temps = [500, 1500, 2500];
const coolingRates = [0.95, 0.99, 0.999];
const maxIters = [1000, 10000, 20000];
const batchSizes = [50, 100, 200];
const syncIntervals = [4, 10];

temps.forEach(initialTemp => {
    coolingRates.forEach(coolingRate => {
        maxIters.forEach(maxIterations => {
            batchSizes.forEach(batchSize => {
                syncIntervals.forEach(syncInterval => {
                    paramGrid.push({
                        initialTemp,
                        coolingRate,
                        maxIterations,
                        batchSize,
                        syncInterval,
                    });
                });
            });
        });
    });
});

interface TuningResult {
    configId: number;
    config: Partial<SimulatedAnnealingConfig>;
    target: OptimizationTarget;
    avgGapPercent: number;
    avgTimeMs: number;
}

async function main() {
    const allFiles = glob.sync('**/*.json', { cwd: PROBLEMS_DIR, absolute: true });
    const validationFiles = allFiles
        .filter(f => {
            const match = f.match(/(\d+)_(\d+)/);
            if (!match) return false;
            const size = parseInt(match[1]) + parseInt(match[2]);
            return size <= MAX_PROBLEM_SIZE_FOR_TUNING;
        })
        .slice(0, 5);

    console.log(`Tuning on ${validationFiles.length} validation problems with ${paramGrid.length} configs...`);

    const bf = new BruteForceAlgorithmRust();
    const psa = new ParallelSimulatedAnnealing();
    const results: TuningResult[] = [];

    const groundTruth = new Map<string, Record<OptimizationTarget, number>>();

    console.log('Calculating Ground Truths...');
    for (const file of validationFiles) {
        const problem: Problem = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const gt: Record<string, number> = {};

        const res = await bf.solve(problem, {
            distanceCalc: greatCircleDistanceCalculator,
            target: OptimizationTarget.DISTANCE,
        });
        for (const t of Object.values(OptimizationTarget)) {
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
