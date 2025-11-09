import { BruteForceAlgorithm } from './algorithms/brute-force';
import { DefaultBenchmarkSuite } from './benchmark/suite';
import { AlgorithmFactory } from './factory';
import { AlgorithmConfig } from './types/algorithm';
import { BenchmarkConfig } from './types/benchmark';
import { ProblemLoader } from './utils/problem-loader';

const problemsDir = './problems';

async function main(): Promise<void> {
    console.log('VRPPD (Vehicle Routing problem with Pickups and Deliveries) Algorithm Benchmark Suite');
    console.log('===================================\n');

    AlgorithmFactory.register(BruteForceAlgorithm.name, () => new BruteForceAlgorithm());

    const loader = new ProblemLoader();
    const problems = await loader.loadFromDirectory(problemsDir);

    if (problems.length === 0) {
        console.error('No problems found');
        process.exit(1);
    }

    const bruteForceAlgorithm = AlgorithmFactory.create(BruteForceAlgorithm.name);

    console.log();
    console.log(`Using algorithm: ${bruteForceAlgorithm.name} v${bruteForceAlgorithm.version}\n`);

    const configs = new Map<string, AlgorithmConfig>();
    configs.set(BruteForceAlgorithm.name, {
        maxIterations: 1,
        timeLimit: 1 * 60 * 1000, // 1 minute max per problem
        verbose: true,
        goal: 'totalDistance',
    });

    const benchmarkConfig: BenchmarkConfig = {
        runs: 3,
        algorithms: [bruteForceAlgorithm],
        problems: problems.map(p => p.instance),
        configs,
        outputPath: './benchmark_results',
    };

    // Run benchmarks
    const benchmarkSuite = new DefaultBenchmarkSuite();

    const startTime = Date.now();
    const results = await benchmarkSuite.run(benchmarkConfig);
    const totalTime = Date.now() - startTime;

    console.log(`\nAll benchmarks completed in ${(totalTime / 1000).toFixed(1)}s\n`);

    await benchmarkSuite.exportResults(results);
}

main().catch(error => {
    console.error('\nBenchmark suite failed:', error.message);
    if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
    }
    process.exit(1);
});
