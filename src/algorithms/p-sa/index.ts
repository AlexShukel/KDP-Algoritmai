import os from 'os';

import {
    AlgorithmConfig,
    AlgorithmResultWithMetadata,
    ConvergenceUpdate,
    OptimizationTarget,
    Problem,
    ProblemSolution,
    SingleTargetAlgorithm,
} from '../../types';
import { buildDistanceMatrix, buildVehicleDistances, DistanceMatrix } from '../../utils/DistanceMatrix';
import { generateRCRS } from './rcrs';
import { Worker } from 'worker_threads';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ParallelSimulatedAnnealing implements SingleTargetAlgorithm {
    type: 'single' = 'single';
    name = 'p-sa-js';

    async solve(problem: Problem, config: AlgorithmConfig): Promise<AlgorithmResultWithMetadata<ProblemSolution>> {
        const distMatrix = buildDistanceMatrix(problem.orders, config.distanceCalc);
        const vehicleStartMatrix = buildVehicleDistances(problem.vehicles, problem.orders, config.distanceCalc);

        const totalCpus = os.cpus().length;
        const threadsPerTarget = Math.max(2, totalCpus);

        return this.solveTarget(config, threadsPerTarget, problem, distMatrix, vehicleStartMatrix);
    }

    // Spawns a pipeline of workers to solve a single target.
    private async solveTarget(
        { target, saConfig }: AlgorithmConfig,
        numThreads: number,
        problem: Problem,
        distMatrix: DistanceMatrix,
        vehicleStartMatrix: DistanceMatrix,
    ): Promise<AlgorithmResultWithMetadata<ProblemSolution>> {
        const initialSolution = generateRCRS(problem, distMatrix, vehicleStartMatrix, target);

        let globalBest = initialSolution;
        let globalBestEnergy = this.getEnergy(initialSolution, target);
        let totalIterations = 0;

        const history: ConvergenceUpdate[] = [
            {
                timeMs: 0,
                iteration: 0,
                metrics: {
                    emptyDistance: initialSolution.emptyDistance,
                    totalDistance: initialSolution.totalDistance,
                    totalPrice: initialSolution.totalPrice,
                },
            },
        ];
        const startTime = performance.now();

        const workers: Worker[] = [];
        const workerPromises: Promise<void>[] = [];

        for (let i = 0; i < numThreads; ++i) {
            workerPromises.push(
                new Promise<void>((resolve, reject) => {
                    const worker = new Worker(path.resolve(__dirname, 'p-sa.worker.es.mjs'));

                    workers.push(worker);

                    worker.on('message', msg => {
                        if (msg.type === 'SYNC_REPORT' || msg.type === 'DONE') {
                            if (msg.energy < globalBestEnergy) {
                                globalBestEnergy = msg.energy;
                                globalBest = msg.solution;

                                history.push({
                                    timeMs: performance.now() - startTime,
                                    iteration: totalIterations,
                                    metrics: {
                                        totalDistance: msg.solution.totalDistance,
                                        totalPrice: msg.solution.totalPrice,
                                        emptyDistance: msg.solution.emptyDistance,
                                    },
                                });
                            }
                        }

                        if (msg.type === 'SYNC_REPORT') {
                            if (i < numThreads - 1) {
                                const nextWorkerIdx = i + 1;
                                const nextWorker = workers[nextWorkerIdx];

                                nextWorker.postMessage({
                                    type: 'INFLUENCE_UPDATE',
                                    solution: msg.solution,
                                    energy: msg.energy,
                                });
                            }
                        }

                        if (msg.type === 'DONE') {
                            worker.terminate();
                            resolve();
                        }

                        ++totalIterations;
                    });

                    worker.on('error', err => {
                        console.error(`Worker error in ${OptimizationTarget[target]} pipeline:`, err);
                        reject(err);
                    });

                    worker.postMessage({
                        type: 'INIT',
                        data: {
                            config: saConfig,
                            target,
                            problem,
                            distMatrix,
                            vehicleStartMatrix,
                            initialSolution,
                            // It is often good to vary start temp slightly per thread
                            initialTemp: (saConfig?.initialTemp || 1000) * (0.9 + Math.random() * 0.2),
                        },
                    });
                }),
            );
        }

        await Promise.all(workerPromises);
        return { solution: globalBest, history };
    }

    private getEnergy(solution: ProblemSolution, target: OptimizationTarget): number {
        switch (target) {
            case OptimizationTarget.EMPTY:
                return solution.emptyDistance;
            case OptimizationTarget.DISTANCE:
                return solution.totalDistance;
            case OptimizationTarget.PRICE:
                return solution.totalPrice;
        }
    }
}
