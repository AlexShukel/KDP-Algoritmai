/**
 * @module brute-force-solver
 * @description
 * The primary entry point for the Brute Force VRP solver.
 *
 * Algorithm:
 * 1. Generates all possible assignments of Orders to Vehicles (Partitioning).
 * 2. For every assignment, generates all possible route permutations for each vehicle.
 * 3. Simulates each route to check constraints and calculate costs.
 * 4. Returns the global minimum based on the configured goal (Price, Total Distance, or Empty Distance).
 *
 * Complexity:
 * The overall complexity is the product of the assignment complexity and the routing complexity.
 * O(V^N * ((2N)! / 2^N))
 * Where V = Number of Vehicles, N = Number of Orders.
 *
 * WARNING:
 * This algorithm is extremely computationally expensive and is suitable ONLY
 * for very small datasets (N < 6) or for validating heuristic solutions.
 */

import { Algorithm, AlgorithmConfig, AlgorithmSolution } from '../../../types/algorithm';
import { Problem, ProblemSolution } from '../../../types/types';
import { BRUTE_FORCE_ERRORS, followRoute } from './followRoute';
import { generateAllOrderAssignments } from './generateAllOrderAssignments';
import { generateAllVehicleRoutes } from './generateAllVehicleRoutes';

export class BruteForceAlgorithm implements Algorithm {
    name: string = 'brute-force-unoptimized';

    // Global best solutions (mutable to share across recursive calls)
    private bestDistance = Infinity;
    private bestPrice = Infinity;
    private bestEmpty = Infinity;

    // To reconstruct the final result
    private bestDistanceSolution: ProblemSolution | null = null;
    private bestPriceSolution: ProblemSolution | null = null;
    private bestEmptySolution: ProblemSolution | null = null;

    solve({ constraints, orders, vehicles }: Problem, config: AlgorithmConfig): AlgorithmSolution {
        this.bestDistance = Infinity;
        this.bestPrice = Infinity;
        this.bestEmpty = Infinity;
        this.bestDistanceSolution = null;
        this.bestPriceSolution = null;
        this.bestEmptySolution = null;

        const allOrderAssignments = generateAllOrderAssignments(orders, vehicles);

        for (const assignment of allOrderAssignments) {
            const currentDistanceSolution: ProblemSolution = {
                totalDistance: 0,
                emptyDistance: 0,
                totalPrice: 0,
                routes: {},
            };
            const currentEmptySolution: ProblemSolution = {
                totalDistance: 0,
                emptyDistance: 0,
                totalPrice: 0,
                routes: {},
            };
            const currentPriceSolution: ProblemSolution = {
                totalDistance: 0,
                emptyDistance: 0,
                totalPrice: 0,
                routes: {},
            };

            for (const [vehicleId, orderIds] of assignment.entries()) {
                const routes = generateAllVehicleRoutes(orders, orderIds);

                let minRouteDistance = Infinity;
                let minRouteEmptyDistance = Infinity;
                let minRoutePrice = Infinity;

                for (const route of routes) {
                    const vehicle = vehicles.find(({ id }) => id === vehicleId)!;
                    try {
                        const { totalDistance, emptyDistance, totalPrice, stops } = followRoute(
                            vehicle,
                            route,
                            constraints.maxTotalDistance,
                            config.distanceCalc,
                        );

                        if (totalDistance < minRouteDistance) {
                            minRouteDistance = totalDistance;
                            currentDistanceSolution.routes[vehicleId] = {
                                emptyDistance,
                                totalDistance,
                                totalPrice,
                                stops,
                            };
                        }

                        if (emptyDistance < minRouteEmptyDistance) {
                            minRouteEmptyDistance = emptyDistance;
                            currentEmptySolution.routes[vehicleId] = {
                                emptyDistance,
                                totalDistance,
                                totalPrice,
                                stops,
                            };
                        }

                        if (totalPrice < minRoutePrice) {
                            minRoutePrice = totalPrice;
                            currentPriceSolution.routes[vehicleId] = {
                                emptyDistance,
                                totalDistance,
                                totalPrice,
                                stops,
                            };
                        }
                    } catch (error) {
                        if (
                            error === BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED ||
                            error === BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED
                        ) {
                            // skip
                        } else {
                            throw error;
                        }
                    }
                }

                if (Number.isFinite(minRouteDistance)) {
                    currentDistanceSolution.totalDistance += currentDistanceSolution.routes[vehicleId].totalDistance;
                    currentDistanceSolution.emptyDistance += currentDistanceSolution.routes[vehicleId].emptyDistance;
                    currentDistanceSolution.totalPrice += currentDistanceSolution.routes[vehicleId].totalPrice;
                }

                if (Number.isFinite(minRouteEmptyDistance)) {
                    currentEmptySolution.totalDistance += currentEmptySolution.routes[vehicleId].totalDistance;
                    currentEmptySolution.emptyDistance += currentEmptySolution.routes[vehicleId].emptyDistance;
                    currentEmptySolution.totalPrice += currentEmptySolution.routes[vehicleId].totalPrice;
                }

                if (Number.isFinite(minRoutePrice)) {
                    currentPriceSolution.totalDistance += currentPriceSolution.routes[vehicleId].totalDistance;
                    currentPriceSolution.emptyDistance += currentPriceSolution.routes[vehicleId].emptyDistance;
                    currentPriceSolution.totalPrice += currentPriceSolution.routes[vehicleId].totalPrice;
                }
            }

            if (
                currentDistanceSolution.totalDistance > 0 &&
                currentDistanceSolution.totalDistance < this.bestDistance
            ) {
                this.bestDistance = currentDistanceSolution.totalDistance;
                this.bestDistanceSolution = currentDistanceSolution;
            }

            if (currentEmptySolution.emptyDistance > 0 && currentEmptySolution.emptyDistance < this.bestEmpty) {
                this.bestEmpty = currentEmptySolution.emptyDistance;
                this.bestEmptySolution = currentEmptySolution;
            }

            if (currentPriceSolution.totalPrice > 0 && currentPriceSolution.totalPrice < this.bestPrice) {
                this.bestPrice = currentPriceSolution.totalPrice;
                this.bestPriceSolution = currentPriceSolution;
            }
        }

        const emptySolution = { routes: {}, emptyDistance: Infinity, totalDistance: Infinity, totalPrice: Infinity };

        return {
            bestDistanceSolution: this.bestDistanceSolution || emptySolution,
            bestPriceSolution: this.bestPriceSolution || emptySolution,
            bestEmptySolution: this.bestEmptySolution || emptySolution,
        };
    }
}
