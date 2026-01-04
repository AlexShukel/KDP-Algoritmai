import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { performance } from 'perf_hooks';
import { Algorithm, AlgorithmConfig, AlgorithmSolution } from './types/algorithm';
import { BruteForceAlgorithm } from './algorithms/brute-force';
import { Problem } from './types/types';
import { greatCircleDistanceCalculator } from './utils/greatCircleDistanceCalculator';
import { jitWarmup } from './jitWarmup';

const PROBLEMS_DIR = 'problems';

const algConfig: AlgorithmConfig = {
    distanceCalc: greatCircleDistanceCalculator,
};

type BenchmarkResult = {
    problemPath: string;
    execTime: number; // milliseconds
    results: AlgorithmSolution;
    problemSize: {
        vehicles: number;
        orders: number;
    };
};

async function main(): Promise<void> {
    const problemFiles = glob.sync('**/*.json', { cwd: PROBLEMS_DIR, absolute: true });

    if (problemFiles.length === 0) {
        console.error('No problem files found.');
        process.exit(1);
    }

    problemFiles.sort((a, b) => {
        const regex = /[\\/](\d+)_(\d+)[\\/]/;

        const matchA = a.match(regex);
        const matchB = b.match(regex);

        if (!matchA || !matchB) {
            return 0;
        }

        const vA = parseInt(matchA[1], 10);
        const oA = parseInt(matchA[2], 10);

        const vB = parseInt(matchB[1], 10);
        const oB = parseInt(matchB[2], 10);

        return vA + oA - (vB + oB);
    });

    const algorithms: Algorithm[] = [new BruteForceAlgorithm()];

    for (const alg of algorithms) {
        console.log(`\n========================================`);
        console.log(`Starting benchmark for: ${alg.name}`);
        console.log(`========================================`);

        jitWarmup(alg, algConfig);

        const benchmarkResults: BenchmarkResult[] = [];

        for (let i = 0; i < problemFiles.length; ++i) {
            const filePath = problemFiles[i];
            const relativePath = path.relative(process.cwd(), filePath);

            const raw = fs.readFileSync(filePath, 'utf-8');
            const problem: Problem = JSON.parse(raw);

            const vCount = problem.vehicles.length;
            const oCount = problem.orders.length;

            const start = performance.now();
            let solution: AlgorithmSolution;
            try {
                solution = alg.solve(problem, algConfig);
            } catch (err) {
                console.error(`\nError solving ${relativePath}.`);
                continue;
            }

            const end = performance.now();
            const duration = end - start;

            console.log(`Done solving ${relativePath} in ${duration.toFixed(2)}ms`);

            benchmarkResults.push({
                problemPath: relativePath,
                execTime: duration,
                problemSize: { vehicles: vCount, orders: oCount },
                results: solution,
            });
        }

        const outputFilename = `benchmark-results-${alg.name}.json`;
        const outputPath = path.resolve(__dirname, outputFilename);

        fs.writeFileSync(outputPath, JSON.stringify(benchmarkResults, null, 2));
        console.log(`\nResults for ${alg.name} saved to ${outputFilename}`);
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

export { BruteForceAlgorithm };
