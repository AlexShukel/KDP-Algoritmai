/**
 * @module brute-force-solver
 * @description
 * The primary entry point for the Brute Force VRP solver.
 *
 * Algorithm:
 * 1. Generates all possible assignments of Orders to Vehicles (Partitioning).
 * 2. For every assignment, generates all possible route permutations for each vehicle.
 * 3. Simulates each route to check constraints and calculate costs.
 * 4. Returns the global minimum for each goal (Price, Total Distance, and Empty Distance).
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

import { AlgorithmConfig } from '../../types/algorithm';
import { Problem, ProblemSolution, VehicleRoute } from '../../types/types';
import { BRUTE_FORCE_ERRORS, followRoute } from './followRoute';
import { generateAllOrderAssignments } from './generateAllOrderAssignments';
import { generateAllVehicleRoutes } from './generateAllVehicleRoutes';

export class BruteForceAlgorithm {
    name: string = 'brute-force';

    solve({ orders, vehicles, constraints }: Problem, config: Pick<AlgorithmConfig, 'distanceCalc'>) {
        const bestDistanceSolution = {
            routes: {},
            emptyDistance: Infinity,
            totalDistance: Infinity,
            totalPrice: Infinity,
        } satisfies ProblemSolution;

        const bestEmptyDistanceSolution = {
            routes: {},
            emptyDistance: Infinity,
            totalDistance: Infinity,
            totalPrice: Infinity,
        } satisfies ProblemSolution;

        const bestPriceSolution = {
            routes: {},
            emptyDistance: Infinity,
            totalDistance: Infinity,
            totalPrice: Infinity,
        } satisfies ProblemSolution;

        const allOrderAssignments = generateAllOrderAssignments(orders, vehicles);

        for (const assignment of allOrderAssignments) {
            let distanceSum = 0;
            let emptyDistanceSum = 0;
            let priceSum = 0;
            const currentRoutesDistance: Record<number, VehicleRoute> = {};
            const currentRoutesEmptyDistance: Record<number, VehicleRoute> = {};
            const currentRoutesPrice: Record<number, VehicleRoute> = {};

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

                        if (emptyDistance < minRouteEmptyDistance) {
                            minRouteEmptyDistance = emptyDistance;

                            currentRoutesEmptyDistance[vehicleId] = {
                                totalDistance,
                                emptyDistance,
                                totalPrice,
                                stops,
                            };
                        }

                        if (totalDistance < minRouteDistance) {
                            minRouteDistance = totalDistance;

                            currentRoutesDistance[vehicleId] = {
                                totalDistance,
                                emptyDistance,
                                totalPrice,
                                stops,
                            };
                        }

                        if (totalPrice < minRoutePrice) {
                            minRoutePrice = totalPrice;

                            currentRoutesPrice[vehicleId] = {
                                totalDistance,
                                emptyDistance,
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

                if (
                    Number.isFinite(minRouteDistance) &&
                    Number.isFinite(minRouteEmptyDistance) &&
                    Number.isFinite(minRoutePrice)
                ) {
                    distanceSum += minRouteDistance;
                    emptyDistanceSum += minRouteEmptyDistance;
                    priceSum += minRoutePrice;
                }
            }

            if (distanceSum === 0 || emptyDistanceSum === 0 || priceSum === 0) {
                continue;
            }

            if (emptyDistanceSum < bestEmptyDistanceSolution.emptyDistance) {
                bestEmptyDistanceSolution.emptyDistance = emptyDistanceSum;
                bestEmptyDistanceSolution.totalDistance = distanceSum;
                bestEmptyDistanceSolution.totalPrice = priceSum;
                bestEmptyDistanceSolution.routes = currentRoutesEmptyDistance;
            }

            if (distanceSum < bestDistanceSolution.totalDistance) {
                bestDistanceSolution.emptyDistance = emptyDistanceSum;
                bestDistanceSolution.totalDistance = distanceSum;
                bestDistanceSolution.totalPrice = priceSum;
                bestDistanceSolution.routes = currentRoutesEmptyDistance;
            }

            if (priceSum < bestPriceSolution.totalPrice) {
                bestPriceSolution.emptyDistance = emptyDistanceSum;
                bestPriceSolution.totalDistance = distanceSum;
                bestPriceSolution.totalPrice = priceSum;
                bestPriceSolution.routes = currentRoutesEmptyDistance;
            }
        }

        return {
            bestEmptyDistanceSolution,
            bestDistanceSolution,
            bestPriceSolution,
        };
    }
}
