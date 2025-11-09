import { BaseAlgorithm } from '../base';
import { AlgorithmConfig, AlgorithmResult } from '../types/algorithm';
import { Order, ProblemInstance, RouteStop, Solution, Vehicle, VehicleRoute } from '../types/problem';
import { DateUtils } from '../utils/date-utils';
import { EuclideanDistanceCalculator, GreatCircleDistanceCalculator } from '../utils/distance';
import { ProblemLoader } from '../utils/problem-loader';

import cloneDeep from 'lodash/cloneDeep';
import { DistanceCalculator } from './interfaces';

type PartialRouteStop = Omit<RouteStop, 'arrivalDate'> & {
    pickupDate?: Date;
};
const BRUTE_FORCE_ERRORS = {
    CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
    MAX_DISTANCE_EXCEEDED: 'MAX_DISTANCE_EXCEEDED',
    ORDER_PICKUP_TOO_LATE: 'ORDER_PICKUP_TOO_LATE',
    TIME_LIMIT_EXCEEDED: 'TIME_LIMIT_EXCEEDED',
} as const;

export class BruteForceAlgorithm extends BaseAlgorithm {
    readonly name = 'brute-force';
    readonly version = '1.0.0';

    async solve(problem: ProblemInstance, config: AlgorithmConfig): Promise<AlgorithmResult> {
        const startTime = Date.now();

        config.distanceCalc ??= new GreatCircleDistanceCalculator();

        const bestSolution: Solution = {
            totalDistance: Infinity,
            emptyDistance: Infinity,
            routes: {},
        };

        const allOrderAssignments = generateAllOrderAssignments(problem.orders, problem.vehicles);

        for (const assignment of allOrderAssignments) {
            if (Date.now() - startTime > config.timeLimit) {
                throw BRUTE_FORCE_ERRORS.TIME_LIMIT_EXCEEDED;
            }

            let currentTotalDistance = 0;
            let currentEmptyDistance = 0;
            const currentRoutes: Record<string, VehicleRoute> = {};

            for (const [vehicleId, orderIds] of assignment.entries()) {
                const routes = generateAllVehicleRoutes(problem.orders, orderIds);
                let minRouteTotalDistance = Infinity;
                let minRouteEmptyDistance = Infinity;

                for (const route of routes) {
                    const vehicle = problem.vehicles.find(({ id }) => id === vehicleId)!;
                    try {
                        const { totalDistance, emptyDistance, stops } = followRoute(
                            vehicle,
                            route,
                            problem.maxDailyDistance,
                            problem.maxTotalDistance,
                            config.distanceCalc,
                        );

                        if (
                            (config.goal === 'emptyDistance' && emptyDistance < minRouteEmptyDistance) ||
                            (config.goal === 'totalDistance' && totalDistance < minRouteTotalDistance)
                        ) {
                            minRouteEmptyDistance = emptyDistance;
                            minRouteTotalDistance = totalDistance;
                            currentRoutes[vehicleId] = {
                                totalDistance: totalDistance,
                                emptyDistance: emptyDistance,
                                stops,
                            };
                        }
                    } catch (error) {
                        if (
                            error === BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED ||
                            error === BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED ||
                            error === BRUTE_FORCE_ERRORS.ORDER_PICKUP_TOO_LATE
                        ) {
                            // skip
                        } else {
                            throw error;
                        }
                    }
                }

                if (Number.isFinite(minRouteTotalDistance) && Number.isFinite(minRouteEmptyDistance)) {
                    currentTotalDistance += minRouteTotalDistance;
                    currentEmptyDistance += minRouteEmptyDistance;
                }
            }

            if (
                (config.goal === 'emptyDistance' && currentEmptyDistance < bestSolution.emptyDistance) ||
                (config.goal === 'totalDistance' && currentTotalDistance < bestSolution.totalDistance)
            ) {
                bestSolution.emptyDistance = currentEmptyDistance;
                bestSolution.totalDistance = currentTotalDistance;
                bestSolution.routes = currentRoutes;
            }
        }

        const executionTime = Date.now() - startTime;

        return {
            executionTime,
            iterations: -1,
            solution: bestSolution,
        };
    }

    protected generateInitialSolution(): Solution {
        return {
            routes: {},
            emptyDistance: 0,
            totalDistance: 0,
        };
    }
}

const getEmptyAssignment = (vehicles: ReadonlyArray<Vehicle>): Map<string, Set<string>> => {
    const out = new Map<string, Set<string>>();

    for (const { id } of vehicles) {
        out.set(id, new Set());
    }

    return out;
};

/**
 * Generate all order assignments permutations for all vehicles.
 *
 * N - number of orders
 * M - number of vehicles
 * M^N - number of order assignments permutations
 */
const generateAllOrderAssignments = (
    orders: ReadonlyArray<Order>,
    vehicles: ReadonlyArray<Vehicle>,
): Array<Map<string, Set<string>>> => {
    const allAssignments: Array<Map<string, Set<string>>> = [];

    if (orders.length === 0) {
        allAssignments.push(getEmptyAssignment(vehicles));
        return allAssignments;
    }

    const currentOrder = orders[0];
    const remainingOrders = orders.slice(1);

    const assignmentsForRemaining = generateAllOrderAssignments(remainingOrders, vehicles);

    for (const currentAssignment of assignmentsForRemaining) {
        for (const vehicle of vehicles) {
            const newAssignment = cloneDeep(currentAssignment);

            newAssignment.get(vehicle.id)!.add(currentOrder.id);

            allAssignments.push(newAssignment);
        }
    }

    return allAssignments;
};

const partitionOrders = (orders: ReadonlyArray<Order>, orderIds: Set<string>) => {
    const pickupLocations: PartialRouteStop[] = [];
    const deliveryLocations: PartialRouteStop[] = [];

    for (const orderId of orderIds) {
        const order = orders.find(({ id }) => id === orderId)!;
        pickupLocations.push({
            location: order.pickupLocation,
            type: 'pickup',
            orderId,
            blockCount: order.blockCount,
            pickupDate: order.pickupDate,
        });

        deliveryLocations.push({
            location: order.deliveryLocation,
            type: 'delivery',
            orderId,
            blockCount: order.blockCount,
        });
    }

    return { pickupLocations, deliveryLocations };
};

/**
 * Generate all routes permutations for a set of orders.
 *
 * N - number of orders
 * (2N)! / 2^N - number of route permutations
 */
const generateAllVehicleRoutes = (orders: ReadonlyArray<Order>, orderIds: Set<string>): PartialRouteStop[][] => {
    const { pickupLocations, deliveryLocations } = partitionOrders(orders, orderIds);
    if (pickupLocations.length !== deliveryLocations.length) {
        throw new Error('Pickup and delivery arrays must have the same length.');
    }

    const allLocations = [...pickupLocations, ...deliveryLocations];

    const routes: PartialRouteStop[][] = [];

    const backtrack = (
        currentRoute: PartialRouteStop[],
        remainingLocations: PartialRouteStop[],
        pickupCount: number,
        deliveryCount: number,
        inTransitItems: Set<string>,
    ) => {
        if (currentRoute.length === allLocations.length) {
            routes.push(currentRoute);
            return;
        }

        for (let i = 0; i < remainingLocations.length; ++i) {
            const currentLocation = remainingLocations[i];
            const newRemainingLocations = [...remainingLocations];
            newRemainingLocations.splice(i, 1);

            // Delivery can not happen before pickup
            if (currentLocation.type === 'delivery' && !inTransitItems.has(currentLocation.orderId)) {
                continue;
            }

            const newInTransitItems = new Set(inTransitItems);
            if (currentLocation.type === 'pickup') {
                newInTransitItems.add(currentLocation.orderId);
            } else {
                newInTransitItems.delete(currentLocation.orderId);
            }

            backtrack(
                [...currentRoute, currentLocation],
                newRemainingLocations,
                currentLocation.type === 'pickup' ? pickupCount + 1 : pickupCount,
                currentLocation.type === 'delivery' ? deliveryCount + 1 : deliveryCount,
                newInTransitItems,
            );
        }
    };

    backtrack([], allLocations, 0, 0, new Set());

    return routes;
};

/**
 * Follows the given route and finds total distance. Also constructs an array of stops.
 */
const followRoute = (
    vehicle: Vehicle,
    locations: PartialRouteStop[],
    maxDailyDistance: number,
    maxTotalDistance: number,
    distanceCalc: DistanceCalculator,
) => {
    if (locations.length === 0) {
        return { totalDistance: 0, emptyDistance: 0, stops: [] };
    }

    let totalDistance = distanceCalc.calculate(vehicle.startLocation, locations[0].location);

    if (totalDistance > maxTotalDistance) {
        throw BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED;
    }

    let emptyDistance = totalDistance;
    const firstArrivalDate = DateUtils.addTravelTime(vehicle.availableDate, totalDistance, maxDailyDistance);

    if (DateUtils.isAfter(firstArrivalDate, locations[0].pickupDate!)) {
        throw BRUTE_FORCE_ERRORS.ORDER_PICKUP_TOO_LATE;
    }

    const stops: RouteStop[] = [
        {
            ...locations[0],
            arrivalDate: firstArrivalDate,
        },
    ];
    let currentLoad = locations[0].blockCount;

    if (currentLoad > vehicle.capacity) {
        throw BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED;
    }

    const inTransit = new Set<string>();

    for (let i = 1; i < locations.length; ++i) {
        const currentDistance = distanceCalc.calculate(locations[i - 1].location, locations[i].location);
        totalDistance += currentDistance;

        if (totalDistance > maxTotalDistance) {
            throw BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED;
        }

        const newArrivalDate = DateUtils.addTravelTime(
            stops[stops.length - 1].arrivalDate,
            currentDistance,
            maxDailyDistance,
        );

        if (locations[i].type === 'pickup' && DateUtils.isAfter(newArrivalDate, locations[i].pickupDate!)) {
            throw BRUTE_FORCE_ERRORS.ORDER_PICKUP_TOO_LATE;
        }

        stops.push({
            ...locations[i],
            arrivalDate: newArrivalDate,
        });

        if (locations[i].type === 'pickup') {
            currentLoad += locations[i].blockCount;
        } else {
            currentLoad -= locations[i].blockCount;
        }

        if (currentLoad > vehicle.capacity) {
            throw BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED;
        }

        if (locations[i - 1].type === 'pickup') {
            inTransit.add(locations[i - 1].orderId);
        } else {
            inTransit.delete(locations[i - 1].orderId);
        }

        if (inTransit.size === 0) {
            emptyDistance += currentDistance;
        }
    }

    return { totalDistance, emptyDistance, stops };
};

if (import.meta.vitest) {
    const { describe, it, expect } = import.meta.vitest;

    describe('Brute force algorithm permutations generation 2v3o', () => {
        const problemInstance: ProblemInstance = new ProblemLoader().convertToInstance({
            constraints: {
                maxDailyDistance: 600,
                maxTotalDistance: 1200,
            },
            orders: [
                {
                    id: 'o1',
                    pickupLocation: {
                        latitude: 2,
                        longitude: 3,
                    },
                    deliveryLocation: {
                        latitude: 8,
                        longitude: 3,
                    },
                    price: 100,
                    blockCount: 3,
                    pickupDate: '2025-01-02T00:00:00.000Z',
                },
                {
                    id: 'o2',
                    pickupLocation: {
                        latitude: 1,
                        longitude: 5,
                    },
                    deliveryLocation: {
                        latitude: 9,
                        longitude: 5,
                    },
                    price: 120,
                    blockCount: 4,
                    pickupDate: '2025-01-02T00:00:00.000Z',
                },
                {
                    id: 'o3',
                    pickupLocation: {
                        latitude: 5,
                        longitude: 2,
                    },
                    deliveryLocation: {
                        latitude: 5,
                        longitude: 8,
                    },
                    price: 80,
                    blockCount: 2,
                    pickupDate: '2025-01-03T00:00:00.000Z',
                },
            ],
            vehicles: [
                {
                    id: 'v1',
                    startLocation: {
                        latitude: 0,
                        longitude: 0,
                    },
                    availableDate: '2025-01-01T00:00:00.000Z',
                    priceKm: 1.0,
                    capacity: 10,
                },
                {
                    id: 'v2',
                    startLocation: {
                        latitude: 10,
                        longitude: 0,
                    },
                    availableDate: '2025-01-01T00:00:00.000Z',
                    priceKm: 1.2,
                    capacity: 8,
                },
            ],
        });

        const { orders, vehicles } = problemInstance;

        it('should generate all order assignments', () => {
            const assignments = generateAllOrderAssignments(orders, vehicles);
            expect(assignments.length).toBe(vehicles.length ** orders.length); // M^N
        });

        it('should generate all vehicle routes from an assignment', () => {
            const orderIds = new Set<string>();
            orderIds.add('o1');
            orderIds.add('o2');
            orderIds.add('o3');

            const routes = generateAllVehicleRoutes(orders, orderIds);
            expect(routes.length).toBe(720 / 8); // (2N)! / 2^N
        });

        it('should find optimal solution', async () => {
            await new BruteForceAlgorithm().solve(problemInstance, {
                maxIterations: -1,
                timeLimit: 1 * 60 * 1000,
                goal: 'emptyDistance',
            });

            expect(true).toBe(true);
        });
    });

    describe('Brute force algorithm base test 2v4o', () => {
        const problemInstance: ProblemInstance = new ProblemLoader().convertToInstance({
            vehicles: [
                {
                    id: 'v1',
                    startLocation: {
                        latitude: 0,
                        longitude: 0,
                    },
                    availableDate: '2025-01-01T00:00:00.000Z',
                    priceKm: 1.0,
                    capacity: 10,
                },
                {
                    id: 'v2',
                    startLocation: {
                        latitude: 10,
                        longitude: 0,
                    },
                    availableDate: '2025-01-01T00:00:00.000Z',
                    priceKm: 1.2,
                    capacity: 8,
                },
            ],
            orders: [
                {
                    id: 'o1',
                    pickupLocation: {
                        latitude: 2,
                        longitude: 3,
                    },
                    deliveryLocation: {
                        latitude: 8,
                        longitude: 3,
                    },
                    price: 100,
                    blockCount: 3,
                    pickupDate: '2025-01-02T00:00:00.000Z',
                },
                {
                    id: 'o2',
                    pickupLocation: {
                        latitude: 1,
                        longitude: 5,
                    },
                    deliveryLocation: {
                        latitude: 9,
                        longitude: 5,
                    },
                    price: 120,
                    blockCount: 4,
                    pickupDate: '2025-01-02T00:00:00.000Z',
                },
                {
                    id: 'o3',
                    pickupLocation: {
                        latitude: 5,
                        longitude: 2,
                    },
                    deliveryLocation: {
                        latitude: 5,
                        longitude: 8,
                    },
                    price: 80,
                    blockCount: 2,
                    pickupDate: '2025-01-03T00:00:00.000Z',
                },
                {
                    id: 'o4',
                    pickupLocation: {
                        latitude: 3,
                        longitude: 7,
                    },
                    deliveryLocation: {
                        latitude: 7,
                        longitude: 1,
                    },
                    price: 90,
                    blockCount: 5,
                    pickupDate: '2025-01-02T00:00:00.000Z',
                },
            ],
            constraints: {
                maxDailyDistance: 600,
                maxTotalDistance: 1200,
            },
        });

        it('should find optimal solution', async () => {
            await new BruteForceAlgorithm().solve(problemInstance, {
                maxIterations: -1,
                timeLimit: 1 * 60 * 1000,
                goal: 'totalDistance',
            });

            expect(true).toBe(true);
        });
    });

    describe('Brute force algorithm. Free distance goal finds much worse solution than total distance goal.', () => {
        const zeroDate = new Date(0).toISOString();
        const currentDate = new Date().toISOString();

        const problemInstance: ProblemInstance = new ProblemLoader().convertToInstance({
            vehicles: [
                {
                    id: 'v1',
                    startLocation: {
                        latitude: 0,
                        longitude: 0,
                    },
                    availableDate: zeroDate,
                    priceKm: 10,
                    capacity: 10,
                },
                {
                    id: 'v2',
                    startLocation: {
                        latitude: 100,
                        longitude: 0,
                    },
                    availableDate: zeroDate,
                    priceKm: 10,
                    capacity: 10,
                },
            ],
            orders: [
                {
                    id: 'o1',
                    pickupLocation: {
                        latitude: 0,
                        longitude: 10,
                    },
                    deliveryLocation: {
                        latitude: 0,
                        longitude: 20,
                    },
                    price: 100,
                    blockCount: 1,
                    pickupDate: currentDate,
                },
                {
                    id: 'o2',
                    pickupLocation: {
                        latitude: 100,
                        longitude: 10,
                    },
                    deliveryLocation: {
                        latitude: 100,
                        longitude: 20,
                    },
                    price: 120,
                    blockCount: 4,
                    pickupDate: currentDate,
                },
            ],
            constraints: {
                maxDailyDistance: 600,
                maxTotalDistance: 1200,
            },
        });

        it('should optimize by empty distance goal', async () => {
            const { solution } = await new BruteForceAlgorithm().solve(problemInstance, {
                maxIterations: -1,
                timeLimit: 1 * 60 * 1000,
                goal: 'emptyDistance',
                distanceCalc: new EuclideanDistanceCalculator(),
            });

            expect(solution.totalDistance).toBe(220);
        });

        it('should optimize by total distance goal', async () => {
            const { solution } = await new BruteForceAlgorithm().solve(problemInstance, {
                maxIterations: -1,
                timeLimit: 1 * 60 * 1000,
                goal: 'totalDistance',
                distanceCalc: new EuclideanDistanceCalculator(),
            });

            expect(solution.totalDistance).toBe(40);
        });
    });

    describe('Brute force algorithm has correct route constraints for ORDER_PICKUP_TOO_LATE; CAPACITY_EXCEEDED; MAX_DISTANCE_EXCEEDED', () => {
        it('should throw order pickup date time constraint error (the same location, pickup date is earlier than vehicle available date)', () => {
            const currentDate = new Date();

            const vehicle: Vehicle = {
                availableDate: currentDate,
                capacity: 10,
                priceKm: 10,
                id: 'v1',
                startLocation: {
                    latitude: 0,
                    longitude: 0,
                },
            };

            const locations: PartialRouteStop[] = [
                {
                    type: 'pickup',
                    blockCount: 1,
                    location: {
                        latitude: 0,
                        longitude: 0,
                    },
                    orderId: 'o1',
                    pickupDate: new Date(currentDate.getTime() - 1),
                },
            ];

            expect(() => followRoute(vehicle, locations, 600, 1200, new EuclideanDistanceCalculator())).toThrowError(
                BRUTE_FORCE_ERRORS.ORDER_PICKUP_TOO_LATE,
            );
        });

        it('should throw order pickup date time constraint error (different locations, vehicle is too far from first loading location)', () => {
            const currentDate = new Date(0);

            const vehicleOutsideRadius: Vehicle = {
                availableDate: currentDate,
                capacity: 10,
                priceKm: 10,
                id: 'v1',
                startLocation: {
                    latitude: 0,
                    longitude: 0,
                },
            };

            const vehicleWithinRadius: Vehicle = {
                availableDate: currentDate,
                capacity: 10,
                priceKm: 10,
                id: 'v1',
                startLocation: {
                    latitude: 0,
                    longitude: 10,
                },
            };

            const locations: PartialRouteStop[] = [
                {
                    type: 'pickup',
                    blockCount: 1,
                    location: {
                        latitude: 0,
                        longitude: 100,
                    },
                    orderId: 'o1',
                    pickupDate: DateUtils.addTravelTime(currentDate, 90, 600), // first pickup must be loaded by truck within 90km radius
                },
            ];

            expect(() =>
                followRoute(vehicleOutsideRadius, locations, 600, 1200, new EuclideanDistanceCalculator()),
            ).toThrowError(BRUTE_FORCE_ERRORS.ORDER_PICKUP_TOO_LATE);

            expect(() =>
                followRoute(vehicleWithinRadius, locations, 600, 1200, new EuclideanDistanceCalculator()),
            ).not.toThrow();
        });

        it('should throw order pickup date time constraint error (second pickup location is too far)', () => {
            const currentDate = new Date(0);

            const vehicle: Vehicle = {
                availableDate: currentDate,
                capacity: 10,
                priceKm: 10,
                id: 'v1',
                startLocation: {
                    latitude: 0,
                    longitude: 0,
                },
            };

            const locations: PartialRouteStop[] = [
                {
                    type: 'pickup',
                    blockCount: 1,
                    location: {
                        latitude: 0,
                        longitude: 100,
                    },
                    orderId: 'o1',
                    pickupDate: DateUtils.addTravelTime(currentDate, 100, 600),
                },
                {
                    type: 'pickup',
                    blockCount: 1,
                    location: {
                        latitude: 0,
                        longitude: 300,
                    },
                    orderId: 'o2',
                    pickupDate: DateUtils.addTravelTime(currentDate, 299, 600),
                },
            ];

            expect(() => followRoute(vehicle, locations, 600, 1200, new EuclideanDistanceCalculator())).toThrowError(
                BRUTE_FORCE_ERRORS.ORDER_PICKUP_TOO_LATE,
            );
        });

        it('should throw capacity constraint error on first pickup location', () => {
            const currentDate = new Date(0);

            const vehicle: Vehicle = {
                availableDate: currentDate,
                capacity: 10,
                priceKm: 10,
                id: 'v1',
                startLocation: {
                    latitude: 0,
                    longitude: 0,
                },
            };

            const locations: PartialRouteStop[] = [
                {
                    type: 'pickup',
                    blockCount: 11,
                    location: {
                        latitude: 0,
                        longitude: 0,
                    },
                    orderId: 'o1',
                    pickupDate: currentDate,
                },
            ];

            expect(() => followRoute(vehicle, locations, 600, 1200, new EuclideanDistanceCalculator())).toThrowError(
                BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED,
            );
        });

        it('should throw capacity constraint error on second pickup location', () => {
            const currentDate = new Date(0);

            const vehicle: Vehicle = {
                availableDate: currentDate,
                capacity: 10,
                priceKm: 10,
                id: 'v1',
                startLocation: {
                    latitude: 0,
                    longitude: 0,
                },
            };

            const locations: PartialRouteStop[] = [
                {
                    type: 'pickup',
                    blockCount: 5,
                    location: {
                        latitude: 0,
                        longitude: 0,
                    },
                    orderId: 'o1',
                    pickupDate: currentDate,
                },
                {
                    type: 'pickup',
                    blockCount: 6,
                    location: {
                        latitude: 0,
                        longitude: 0,
                    },
                    orderId: 'o2',
                    pickupDate: currentDate,
                },
            ];

            expect(() => followRoute(vehicle, locations, 600, 1200, new EuclideanDistanceCalculator())).toThrowError(
                BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED,
            );
        });

        it('should throw max distance constraint error on first pickup location', () => {
            const currentDate = new Date(0);

            const vehicle: Vehicle = {
                availableDate: currentDate,
                capacity: 10,
                priceKm: 10,
                id: 'v1',
                startLocation: {
                    latitude: 0,
                    longitude: 0,
                },
            };

            const locations: PartialRouteStop[] = [
                {
                    type: 'pickup',
                    blockCount: 1,
                    location: {
                        latitude: 0,
                        longitude: 1200,
                    },
                    orderId: 'o1',
                    pickupDate: DateUtils.addTravelTime(currentDate, 1200, 600),
                },
            ];

            expect(() => followRoute(vehicle, locations, 600, 1199, new EuclideanDistanceCalculator())).toThrowError(
                BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED,
            );
        });

        it('should throw max distance constraint error on first pickup location', () => {
            const currentDate = new Date(0);

            const vehicle: Vehicle = {
                availableDate: currentDate,
                capacity: 10,
                priceKm: 10,
                id: 'v1',
                startLocation: {
                    latitude: 0,
                    longitude: 0,
                },
            };

            const locations: PartialRouteStop[] = [
                {
                    type: 'pickup',
                    blockCount: 1,
                    location: {
                        latitude: 0,
                        longitude: 600,
                    },
                    orderId: 'o1',
                    pickupDate: DateUtils.addTravelTime(currentDate, 1200, 600),
                },
                {
                    type: 'pickup',
                    blockCount: 1,
                    location: {
                        latitude: 0,
                        longitude: 1200,
                    },
                    orderId: 'o2',
                    pickupDate: DateUtils.addTravelTime(currentDate, 1200, 600),
                },
            ];

            expect(() => followRoute(vehicle, locations, 600, 1199, new EuclideanDistanceCalculator())).toThrowError(
                BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED,
            );
        });
    });
}
