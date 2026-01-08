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
 */

import { solveBruteForce } from 'rust-solver';
import {
    AlgorithmConfig,
    Order,
    Problem,
    ProblemSolution,
    RouteStop,
    Vehicle,
    VehicleRoute,
    AlgorithmSolution,
    MultiTargetAlgorithm,
    AlgorithmResultWithMetadata,
} from '../../types';
import { iterateAllSubsets } from './iterateAllSubsets';
import { buildDistanceMatrix, buildVehicleDistances, DistanceMatrix } from '../../utils/DistanceMatrix';

type MemoKey = number; // integer representing (vehicleIndex << 20) | mask
type AccumulatedSolution = { distSum: number; priceSum: number; emptySum: number };
type TSPResult = {
    minDistanceRoute: VehicleRoute;
    minEmptyRoute: VehicleRoute;
    minPriceRoute: VehicleRoute;
};

const MAX_PROBLEM_SIZE = 7;

export class BruteForceAlgorithmRust implements MultiTargetAlgorithm {
    type: 'multi' = 'multi';
    name: string = 'brute-force-rust';

    public solve(problem: Problem, config: AlgorithmConfig): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
        if (problem.orders.length > MAX_PROBLEM_SIZE || problem.vehicles.length > MAX_PROBLEM_SIZE) {
            throw new Error(`Problem too large for ${this.name} implementation.`);
        }

        return new Promise(res => res({ solution: solveBruteForce(problem), history: [] }));
    }
}

export class BruteForceAlgorithmJS implements MultiTargetAlgorithm {
    type: 'multi' = 'multi';
    name: string = 'brute-force-js';

    // Global best solutions (mutable to share across recursive calls)
    private bestDistance = Infinity;
    private bestPrice = Infinity;
    private bestEmpty = Infinity;

    // To reconstruct the final result
    private bestDistanceSolution: ProblemSolution | null = null;
    private bestPriceSolution: ProblemSolution | null = null;
    private bestEmptySolution: ProblemSolution | null = null;

    // Caches
    private routeCache: Map<MemoKey, TSPResult | null> = new Map();
    private distancesMat: DistanceMatrix = [];
    private vehicleStartDistancesMat: DistanceMatrix = []; // [vehicleIndex][orderIndex]

    solve(problem: Problem, config: AlgorithmConfig): Promise<AlgorithmResultWithMetadata<AlgorithmSolution>> {
        return new Promise(res => res(this.solveSync(problem, config)));
    }

    public solveSync(
        { orders, vehicles }: Problem,
        config: AlgorithmConfig,
    ): AlgorithmResultWithMetadata<AlgorithmSolution> {
        if (orders.length > MAX_PROBLEM_SIZE || vehicles.length > MAX_PROBLEM_SIZE) {
            throw new Error(`Problem too large for ${this.name} implementation.`);
        }

        const N = orders.length;
        const V = vehicles.length;

        // Init state
        this.bestDistance = Infinity;
        this.bestPrice = Infinity;
        this.bestEmpty = Infinity;
        this.bestDistanceSolution = null;
        this.bestPriceSolution = null;
        this.bestEmptySolution = null;
        this.routeCache.clear();
        this.distancesMat = buildDistanceMatrix(orders, config.distanceCalc);
        this.vehicleStartDistancesMat = buildVehicleDistances(vehicles, orders, config.distanceCalc);

        this.solveRecursive(
            0,
            0,
            { distSum: 0, priceSum: 0, emptySum: 0 },
            new Array(V).fill(0),
            orders,
            vehicles,
            (1 << N) - 1, // target mask (all bits set)
        );

        const emptySolution = { routes: {}, emptyDistance: Infinity, totalDistance: Infinity, totalPrice: Infinity };

        return {
            solution: {
                bestDistanceSolution: this.bestDistanceSolution || emptySolution,
                bestPriceSolution: this.bestPriceSolution || emptySolution,
                bestEmptySolution: this.bestEmptySolution || emptySolution,
            },
            history: [],
        };
    }

    // Create a unique key for cache: VehicleID (upper bits) | OrderMask (lower bits)
    // Assuming < 20 orders, this shift is safe.
    private getRouteCacheKey = (index: number, mask: number) => (index << 20) | mask;

    private updateBestSolutions(current: AccumulatedSolution, assignments: number[], vehicles: Vehicle[]) {
        if (current.distSum < this.bestDistance) {
            this.bestDistance = current.distSum;
            this.bestDistanceSolution = this.reconstructSolution(assignments, vehicles, 'dist');
        }

        if (current.priceSum < this.bestPrice) {
            this.bestPrice = current.priceSum;
            this.bestPriceSolution = this.reconstructSolution(assignments, vehicles, 'price');
        }

        if (current.emptySum < this.bestEmpty) {
            this.bestEmpty = current.emptySum;
            this.bestEmptySolution = this.reconstructSolution(assignments, vehicles, 'empty');
        }
    }

    private reconstructSolution(
        assignments: number[],
        vehicles: Vehicle[],
        type: 'dist' | 'empty' | 'price',
    ): ProblemSolution {
        const routes: Record<number, VehicleRoute> = {};
        let totalDistance = 0;
        let totalPrice = 0;
        let emptyDistance = 0;

        for (let i = 0; i < vehicles.length; ++i) {
            const mask = assignments[i];
            if (mask > 0) {
                const cacheKey = this.getRouteCacheKey(i, mask);
                const cached = this.routeCache.get(cacheKey);
                if (cached) {
                    // FIXME: optimize this branching
                    const r =
                        type === 'dist'
                            ? cached.minDistanceRoute
                            : type === 'price'
                              ? cached.minPriceRoute
                              : cached.minEmptyRoute;

                    routes[vehicles[i].id] = r;
                    totalDistance += r.totalDistance;
                    totalPrice += r.totalPrice;
                    emptyDistance += r.emptyDistance;
                }
            }
        }

        return { routes, totalDistance, totalPrice, emptyDistance };
    }

    private solveRecursive(
        vehicleIndex: number,
        assignmentMask: number, // currently assigned orders
        currentSolution: AccumulatedSolution,
        assignments: number[], // vehicleIndex -> assignmentMask
        orders: Order[],
        vehicles: Vehicle[],
        fullMask: number,
    ) {
        // Stop early if currentSolution is worse for all optimization goals
        if (
            currentSolution.distSum >= this.bestDistance &&
            currentSolution.priceSum >= this.bestPrice &&
            currentSolution.emptySum >= this.bestEmpty
        ) {
            return;
        }

        // Base Case: all orders assigned
        if (assignmentMask === fullMask) {
            this.updateBestSolutions(currentSolution, assignments, vehicles);
            return;
        }

        // Base Case: no more vehicles
        if (vehicleIndex >= vehicles.length) {
            return;
        }

        const solveCurrentIteration = (mask: number) => {
            const routeResult = this.getBestRoute(vehicleIndex, mask, vehicles, orders);

            if (routeResult) {
                assignments[vehicleIndex] = mask;
                this.solveRecursive(
                    vehicleIndex + 1,
                    assignmentMask | mask,
                    {
                        distSum: currentSolution.distSum + routeResult.minDistanceRoute.totalDistance,
                        priceSum: currentSolution.priceSum + routeResult.minPriceRoute.totalPrice,
                        emptySum: currentSolution.emptySum + routeResult.minEmptyRoute.emptyDistance,
                    },
                    assignments,
                    orders,
                    vehicles,
                    fullMask,
                );
                assignments[vehicleIndex] = 0;
            }
        };

        iterateAllSubsets(assignmentMask, fullMask, solveCurrentIteration);

        // Case: Vehicle takes NO orders (empty mask)
        this.solveRecursive(vehicleIndex + 1, assignmentMask, currentSolution, assignments, orders, vehicles, fullMask);
    }

    // Finds the optimal route for a set of orders and vehicle. Uses memoization.
    private getBestRoute(vehicleIndex: number, mask: number, vehicles: Vehicle[], orders: Order[]): TSPResult | null {
        const cacheKey = this.getRouteCacheKey(vehicleIndex, mask);

        if (this.routeCache.has(cacheKey)) {
            return this.routeCache.get(cacheKey) ?? null;
        }

        // Decode order mask to indices
        const orderIndices: number[] = [];
        for (let i = 0; i < orders.length; ++i) {
            if ((mask >> i) & 1) {
                orderIndices.push(i);
            }
        }

        const solution = this.solveTSP(vehicleIndex, orderIndices, vehicles[vehicleIndex], orders);

        // if the solution is null it means that constraints are not met, but configuration is valid
        this.routeCache.set(cacheKey, solution);
        return solution;
    }

    // Finds an optimal route by generating permutations for a specific vehicle and specific orders
    private solveTSP(
        vehicleIndex: number,
        orderIndices: number[],
        vehicle: Vehicle,
        orders: Order[],
    ): TSPResult | null {
        let bestDistVal = Infinity;
        let bestEmptyVal = Infinity;
        let bestPriceVal = Infinity;

        let bestDistRoute: VehicleRoute | null = null;
        let bestEmptyRoute: VehicleRoute | null = null;
        let bestPriceRoute: VehicleRoute | null = null;

        let targetMask = 0;
        for (const idx of orderIndices) {
            targetMask |= 1 << idx;
        }

        const tspRecursive = (
            lastNodeIndex: number | null,
            currentDist: number,
            currentEmpty: number,
            currentPrice: number,
            currentLoad: number,
            stops: RouteStop[],
            pickedUpMask: number,
            deliveredMask: number,
        ) => {
            if (currentDist >= bestDistVal && currentEmpty >= bestEmptyVal && currentPrice >= bestPriceVal) {
                return;
            }

            // Base case: all orders delivered
            if (deliveredMask === targetMask) {
                if (currentDist < bestDistVal) {
                    bestDistVal = currentDist;
                    bestDistRoute = {
                        stops: [...stops],
                        totalDistance: currentDist,
                        emptyDistance: currentEmpty,
                        totalPrice: currentPrice,
                    };
                }

                if (currentEmpty < bestEmptyVal) {
                    bestEmptyVal = currentEmpty;
                    bestEmptyRoute = {
                        stops: [...stops],
                        totalDistance: currentDist,
                        emptyDistance: currentEmpty,
                        totalPrice: currentPrice,
                    };
                }

                if (currentPrice < bestPriceVal) {
                    bestPriceVal = currentPrice;
                    bestPriceRoute = {
                        stops: [...stops],
                        totalDistance: currentDist,
                        emptyDistance: currentEmpty,
                        totalPrice: currentPrice,
                    };
                }

                return;
            }

            for (const orderIndex of orderIndices) {
                const orderBit = 1 << orderIndex;

                // OPTION A: PICKUP
                if ((pickedUpMask & orderBit) === 0) {
                    const order = orders[orderIndex];
                    const addedLoad = 1 / order.loadFactor;

                    if (currentLoad + addedLoad > 1) {
                        continue;
                    }

                    let legDistance = 0;
                    if (lastNodeIndex === null) {
                        legDistance = this.vehicleStartDistancesMat[vehicleIndex][orderIndex];
                    } else {
                        legDistance = this.distancesMat[lastNodeIndex][2 * orderIndex];
                    }

                    const newDist = currentDist + legDistance;
                    const isMovingEmpty = pickedUpMask === deliveredMask;
                    const newEmpty = currentEmpty + (isMovingEmpty ? legDistance : 0);
                    const newPrice = currentPrice + legDistance * vehicle.priceKm;

                    stops.push({ type: 'pickup', orderId: order.id });
                    tspRecursive(
                        2 * orderIndex,
                        newDist,
                        newEmpty,
                        newPrice,
                        currentLoad + addedLoad,
                        stops,
                        pickedUpMask | orderBit,
                        deliveredMask,
                    );
                    stops.pop();
                }

                // OPTION B: DELIVERY
                else if ((pickedUpMask & orderBit) !== 0 && (deliveredMask & orderBit) === 0) {
                    const order = orders[orderIndex];
                    const removedLoad = 1 / order.loadFactor;

                    const legDistance = this.distancesMat[lastNodeIndex!][2 * orderIndex + 1];

                    const newDist = currentDist + legDistance;
                    const newEmpty = currentEmpty;
                    const newPrice = currentPrice + legDistance * vehicle.priceKm;

                    stops.push({ type: 'delivery', orderId: order.id });
                    tspRecursive(
                        2 * orderIndex + 1,
                        newDist,
                        newEmpty,
                        newPrice,
                        currentLoad - removedLoad,
                        stops,
                        pickedUpMask,
                        deliveredMask | orderBit,
                    );
                    stops.pop();
                }
            }
        };

        tspRecursive(null, 0, 0, 0, 0, [], 0, 0);

        if (!bestDistRoute || !bestEmptyRoute || !bestPriceRoute) return null;

        return {
            minDistanceRoute: bestDistRoute,
            minEmptyRoute: bestEmptyRoute,
            minPriceRoute: bestPriceRoute,
        };
    }
}
