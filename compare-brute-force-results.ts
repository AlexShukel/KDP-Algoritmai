/**
 * @file compare-results.ts
 * @description
 *
 * Compares benchmark results between two algorithms to verify correctness.
 */

import fs from 'fs';
import path from 'path';

const FILE_OPTIMIZED = 'dist/benchmark-results-brute-force.json';
const FILE_UNOPTIMIZED = 'dist/benchmark-results-brute-force-unoptimized.json';

const EPSILON = 1e-4;

interface SolutionMetrics {
    totalDistance: number;
    totalPrice: number;
    emptyDistance: number;
}

interface AlgorithmResult {
    bestDistanceSolution: SolutionMetrics;
    bestPriceSolution: SolutionMetrics;
    bestEmptySolution: SolutionMetrics;
}

interface BenchmarkEntry {
    problemPath: string;
    results: AlgorithmResult;
}

const loadJSON = (filename: string): BenchmarkEntry[] => {
    const filePath = path.resolve(__dirname, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
};

const isClose = (a: number, b: number) => Math.abs(a - b) < EPSILON;

const formatValue = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : 'Inf');

const printMismatch = (problem: string, target: string, valOpt: number, valUnopt: number) => {
    console.log(`  ❌ [${target}] Mismatch!`);
    console.log(`     Opt:   ${formatValue(valOpt)}`);
    console.log(`     Unopt: ${formatValue(valUnopt)}`);
    console.log(`     Diff:  ${Math.abs(valOpt - valUnopt).toFixed(6)}`);
};

const main = () => {
    console.log(`Loading ${FILE_OPTIMIZED}...`);
    const optimizedData = loadJSON(FILE_OPTIMIZED);

    console.log(`Loading ${FILE_UNOPTIMIZED}...`);
    const unoptimizedData = loadJSON(FILE_UNOPTIMIZED);

    const baselineMap = new Map<string, BenchmarkEntry>();
    unoptimizedData.forEach(entry => baselineMap.set(entry.problemPath, entry));

    let totalCompared = 0;
    let totalMismatches = 0;
    let missingInBaseline = 0;

    console.log(`\nStarting comparison of ${optimizedData.length} problems...\n`);

    for (const optEntry of optimizedData) {
        const problemPath = optEntry.problemPath;
        const baselineEntry = baselineMap.get(problemPath);

        if (!baselineEntry) {
            missingInBaseline++;
            continue;
        }

        totalCompared++;
        let hasError = false;

        const optRes = optEntry.results;
        const baseRes = baselineEntry.results;

        if (!isClose(optRes.bestDistanceSolution.totalDistance, baseRes.bestDistanceSolution.totalDistance)) {
            console.log(`File: ${problemPath}`);
            printMismatch(
                problemPath,
                'Min Total Distance',
                optRes.bestDistanceSolution.totalDistance,
                baseRes.bestDistanceSolution.totalDistance,
            );
            hasError = true;
        }

        if (!isClose(optRes.bestPriceSolution.totalPrice, baseRes.bestPriceSolution.totalPrice)) {
            if (!hasError) console.log(`File: ${problemPath}`);
            printMismatch(
                problemPath,
                'Min Total Price',
                optRes.bestPriceSolution.totalPrice,
                baseRes.bestPriceSolution.totalPrice,
            );
            hasError = true;
        }

        if (!isClose(optRes.bestEmptySolution.emptyDistance, baseRes.bestEmptySolution.emptyDistance)) {
            if (!hasError) console.log(`File: ${problemPath}`);
            printMismatch(
                problemPath,
                'Min Empty Distance',
                optRes.bestEmptySolution.emptyDistance,
                baseRes.bestEmptySolution.emptyDistance,
            );
            hasError = true;
        }

        if (hasError) {
            totalMismatches++;
            console.log('-'.repeat(40));
        }
    }

    console.log('\n================ SUMMARY ================');
    console.log(`Total Problems in Optimized Set:  ${optimizedData.length}`);
    console.log(`Common Problems Compared:         ${totalCompared}`);
    console.log(`Missing in Baseline (Skipped):    ${missingInBaseline}`);
    console.log('-----------------------------------------');

    if (totalMismatches === 0) {
        console.log(`✅ SUCCESS: All ${totalCompared} solutions match!`);
    } else {
        console.log(`❌ FAILURE: Found ${totalMismatches} discrepancies.`);
    }
    console.log('=========================================');

    if (totalMismatches > 0) process.exit(1);
};

main();
