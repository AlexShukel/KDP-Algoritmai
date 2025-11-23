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

import { Algorithm, AlgorithmConfig } from '../../types/algorithm';
import { Problem, ProblemSolution, VehicleRoute } from '../../types/types';
import { BRUTE_FORCE_ERRORS, followRoute } from './followRoute';
import { generateAllOrderAssignments } from './generateAllOrderAssignments';
import { generateAllVehicleRoutes } from './generateAllVehicleRoutes';

export class BruteForceAlgorithm implements Algorithm {
    name: string = 'brute-force';

    solve({ constraints, orders, vehicles }: Problem, config: AlgorithmConfig): ProblemSolution {
        const bestSolution = {
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
            const currentRoutes: Record<number, VehicleRoute> = {};

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

                        if (
                            (config.goal === 'emptyDistance' && emptyDistance < minRouteEmptyDistance) ||
                            (config.goal === 'totalDistance' && totalDistance < minRouteDistance) ||
                            (config.goal === 'totalPrice' && totalPrice < minRoutePrice)
                        ) {
                            minRouteEmptyDistance = emptyDistance;
                            minRouteDistance = totalDistance;
                            minRoutePrice = totalPrice;

                            currentRoutes[vehicleId] = {
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

            if (
                (config.goal === 'emptyDistance' && emptyDistanceSum < bestSolution.emptyDistance) ||
                (config.goal === 'totalDistance' && distanceSum < bestSolution.totalDistance) ||
                (config.goal === 'totalPrice' && priceSum < bestSolution.totalPrice)
            ) {
                bestSolution.emptyDistance = emptyDistanceSum;
                bestSolution.totalDistance = distanceSum;
                bestSolution.totalPrice = priceSum;
                bestSolution.routes = currentRoutes;
            }
        }

        return bestSolution;
    }
}
