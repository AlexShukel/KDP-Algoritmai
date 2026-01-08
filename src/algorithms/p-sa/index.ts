import os from 'os';

import { AlgorithmConfig, OptimizationTarget, Problem, ProblemSolution, SingleTargetAlgorithm } from '../../types';
import { buildDistanceMatrix, buildVehicleDistances, DistanceMatrix } from '../../utils/DistanceMatrix';
import { generateRCRS } from './rcrs';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ParallelSimulatedAnnealing implements SingleTargetAlgorithm {
    type: 'single' = 'single';
    name = 'p-sa-js';

    async solve(problem: Problem, config: AlgorithmConfig): Promise<ProblemSolution> {
        const distMatrix = buildDistanceMatrix(problem.orders, config.distanceCalc);
        const vehicleStartMatrix = buildVehicleDistances(problem.vehicles, problem.orders, config.distanceCalc);

        const totalCpus = os.cpus().length;
        const threadsPerTarget = Math.max(2, totalCpus);

        return this.solveTarget(config.target, threadsPerTarget, problem, distMatrix, vehicleStartMatrix);
    }

    // Spawns a pipeline of workers to solve a single target.
    private async solveTarget(
        target: OptimizationTarget,
        numThreads: number,
        problem: Problem,
        distMatrix: DistanceMatrix,
        vehicleStartMatrix: DistanceMatrix,
    ): Promise<ProblemSolution> {
        const initialSolution = generateRCRS(problem, distMatrix, vehicleStartMatrix, target);

        let globalBest = initialSolution;
        let globalBestEnergy = this.getEnergy(initialSolution, target);

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
                    });

                    worker.on('error', err => {
                        console.error(`Worker error in ${OptimizationTarget[target]} pipeline:`, err);
                        reject(err);
                    });

                    worker.postMessage({
                        type: 'INIT',
                        data: {
                            target,
                            problem,
                            distMatrix,
                            vehicleStartMatrix,
                            initialSolution,
                            initialTemp: 1000 + Math.random() * 500,
                        },
                    });
                }),
            );
        }

        await Promise.all(workerPromises);
        return globalBest;
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
