/**
 * RCRS (Residual Capacity and Radial Surcharge) heuristic implementation for VRPPD.
 * This module generates an initial valid solution by greedily inserting orders into vehicle routes
 * based on a weighted cost function that adapts to the specific optimization target (Empty Distance, Total Distance or Price),
 * utilizing random shuffling to ensure diversity for parallel execution.
 */

import {
    Location,
    OptimizationTarget,
    Order,
    Problem,
    ProblemSolution,
    RouteStop,
    Vehicle,
    VehicleRoute,
} from '../../types';
import { DistanceMatrix } from '../../utils/DistanceMatrix';

// TODO: use RCRS coefficients to calculate the cost instead of random shuffle
function shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; --i) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
}

export const generateRCRS = (
    problem: Problem,
    distMatrix: DistanceMatrix,
    vehicleStartMatrix: DistanceMatrix,
    target: OptimizationTarget,
): ProblemSolution => {
    const routes: Record<number, VehicleRoute> = {};
    problem.vehicles.forEach(v => {
        routes[v.id] = {
            stops: [],
            totalDistance: 0,
            emptyDistance: 0,
            totalPrice: 0,
        };
    });

    const orderIdToIndex = new Map<number, number>();
    problem.orders.forEach((o, i) => orderIdToIndex.set(o.id, i));

    const vehicleIdToIndex = new Map<number, number>();
    problem.vehicles.forEach((v, i) => vehicleIdToIndex.set(v.id, i));

    const unassignedOrders = shuffleArray([...problem.orders]);

    for (const order of unassignedOrders) {
        let bestInsertion = {
            vehicleId: -1,
            pickupIdx: -1,
            deliveryIdx: -1,
            cost: Infinity,
        };

        for (const vehicle of problem.vehicles) {
            const route = routes[vehicle.id];

            for (let i = 0; i <= route.stops.length; ++i) {
                for (let j = i + 1; j <= route.stops.length + 1; ++j) {
                    const metrics = estimateInsertionMetrics(
                        route,
                        vehicle,
                        order,
                        i,
                        j,
                        distMatrix,
                        vehicleStartMatrix,
                        orderIdToIndex,
                        vehicleIdToIndex,
                        problem,
                    );

                    if (metrics === null) {
                        continue;
                    }

                    let cost = Infinity;

                    if (target === OptimizationTarget.PRICE) {
                        cost = metrics.deltaTotal * vehicle.priceKm;
                    } else if (target === OptimizationTarget.DISTANCE) {
                        cost = metrics.deltaTotal;
                    } else if (target === OptimizationTarget.EMPTY) {
                        const vIdx = vehicleIdToIndex.get(vehicle.id)!;
                        const oIdx = orderIdToIndex.get(order.id)!;
                        const startToPickup = vehicleStartMatrix[vIdx][oIdx];
                        cost = metrics.deltaEmpty + 0.4 * startToPickup;
                    }

                    if (cost < bestInsertion.cost) {
                        bestInsertion = {
                            vehicleId: vehicle.id,
                            pickupIdx: i,
                            deliveryIdx: j,
                            cost: cost,
                        };
                    }
                }
            }
        }

        if (bestInsertion.vehicleId !== -1) {
            const vId = bestInsertion.vehicleId;
            const r = routes[vId];
            r.stops.splice(bestInsertion.pickupIdx, 0, { orderId: order.id, type: 'pickup' });
            r.stops.splice(bestInsertion.deliveryIdx, 0, { orderId: order.id, type: 'delivery' });

            const veh = problem.vehicles[vehicleIdToIndex.get(vId)!];
            updateRouteStats(r, veh, problem, distMatrix, vehicleStartMatrix, orderIdToIndex);
        }
    }

    return calculateFullSolution(routes);
};

function estimateInsertionMetrics(
    route: VehicleRoute,
    vehicle: Vehicle,
    order: Order,
    pIdx: number,
    dIdx: number,
    distMatrix: DistanceMatrix,
    vehicleStartMatrix: DistanceMatrix,
    orderMap: Map<number, number>,
    vehicleMap: Map<number, number>,
    problem: Problem,
): { deltaTotal: number; deltaEmpty: number } | null {
    const tempStops = [...route.stops];
    tempStops.splice(pIdx, 0, { orderId: order.id, type: 'pickup' });
    tempStops.splice(dIdx, 0, { orderId: order.id, type: 'delivery' });

    if (!isValidRoute(tempStops, problem)) {
        return null;
    }

    let newTotalDist = 0;
    let newEmptyDist = 0;
    let currentLoad = 0;
    const vIdx = vehicleMap.get(vehicle.id)!;

    if (tempStops.length > 0) {
        const firstStop = tempStops[0];
        const firstOrder = problem.orders[orderMap.get(firstStop.orderId)!];
        const firstOrderIdx = orderMap.get(firstStop.orderId)!;

        const d = vehicleStartMatrix[vIdx][firstOrderIdx];
        newTotalDist += d;
        newEmptyDist += d;

        currentLoad += 1 / firstOrder.loadFactor;

        for (let i = 0; i < tempStops.length - 1; i++) {
            const from = tempStops[i];
            const to = tempStops[i + 1];

            const u = orderMap.get(from.orderId)! * 2 + (from.type === 'delivery' ? 1 : 0);
            const v = orderMap.get(to.orderId)! * 2 + (to.type === 'delivery' ? 1 : 0);

            const dist = distMatrix[u][v];

            newTotalDist += dist;

            if (Math.abs(currentLoad) < 1e-6) {
                newEmptyDist += dist;
            }

            const nextOrder = problem.orders[orderMap.get(to.orderId)!];
            const loadChange = 1 / nextOrder.loadFactor;

            if (to.type === 'pickup') {
                currentLoad += loadChange;
            } else {
                currentLoad -= loadChange;
            }
        }
    }

    return {
        deltaTotal: newTotalDist - route.totalDistance,
        deltaEmpty: newEmptyDist - route.emptyDistance,
    };
}

function isValidRoute(stops: RouteStop[], problem: Problem): boolean {
    const pickedUp = new Set<number>();
    const delivered = new Set<number>();
    let currentLoad = 0;
    const MAX_LOAD = 1.0;

    for (const stop of stops) {
        const order = problem.orders.find(o => o.id === stop.orderId);
        if (!order) return false;

        const loadChange = 1 / order.loadFactor;

        if (stop.type === 'pickup') {
            if (pickedUp.has(order.id)) return false;
            pickedUp.add(order.id);
            currentLoad += loadChange;
        } else {
            if (!pickedUp.has(order.id)) return false;
            if (delivered.has(order.id)) return false;
            delivered.add(order.id);
            currentLoad -= loadChange;
        }

        if (currentLoad > MAX_LOAD + 1e-6) return false;
    }

    if (pickedUp.size !== delivered.size) return false;

    return true;
}

function updateRouteStats(
    route: VehicleRoute,
    vehicle: Vehicle,
    problem: Problem,
    distMatrix: DistanceMatrix,
    vehicleStartMatrix: DistanceMatrix,
    orderMap: Map<number, number>,
) {
    let totalDist = 0;
    let emptyDist = 0;
    let currentLoad = 0;
    const vIdx = problem.vehicles.findIndex(v => v.id === vehicle.id);

    if (route.stops.length > 0) {
        const firstStop = route.stops[0];
        const firstOrder = problem.orders.find(o => o.id === firstStop.orderId)!;
        const firstOrderIdx = orderMap.get(firstStop.orderId)!;

        const startDist = vehicleStartMatrix[vIdx][firstOrderIdx];
        totalDist += startDist;
        emptyDist += startDist;

        currentLoad += 1 / firstOrder.loadFactor;

        for (let i = 0; i < route.stops.length - 1; i++) {
            const from = route.stops[i];
            const to = route.stops[i + 1];

            const u = orderMap.get(from.orderId)! * 2 + (from.type === 'delivery' ? 1 : 0);
            const v = orderMap.get(to.orderId)! * 2 + (to.type === 'delivery' ? 1 : 0);

            const d = distMatrix[u][v];
            totalDist += d;

            if (Math.abs(currentLoad) < 1e-6) {
                emptyDist += d;
            }

            const nextOrder = problem.orders.find(o => o.id === to.orderId)!;
            const loadChange = 1 / nextOrder.loadFactor;

            if (to.type === 'pickup') {
                currentLoad += loadChange;
            } else {
                currentLoad -= loadChange;
            }
        }
    }

    route.totalDistance = totalDist;
    route.emptyDistance = emptyDist;
    route.totalPrice = totalDist * vehicle.priceKm;
}

function calculateFullSolution(routes: Record<number, VehicleRoute>): ProblemSolution {
    let totalDist = 0;
    let emptyDist = 0;
    let totalPrice = 0;
    const routesStrKey: Record<string, VehicleRoute> = {};

    Object.keys(routes).forEach(key => {
        const numKey = Number(key);
        const r = routes[numKey];
        totalDist += r.totalDistance;
        emptyDist += r.emptyDistance;
        totalPrice += r.totalPrice;
        routesStrKey[String(numKey)] = r;
    });

    return {
        routes: routesStrKey,
        totalDistance: totalDist,
        emptyDistance: emptyDist,
        totalPrice: totalPrice,
    };
}

if (import.meta.vitest) {
    const { describe, it, expect } = import.meta.vitest;

    describe('RCRS Heuristic', () => {
        const createLoc = (x: number, y: number): Location => ({
            hash: `${x},${y}`,
            latitude: x,
            longitude: y,
        });

        const createVehicle = (id: number, x: number, y: number, maxLoad = 1.0): Vehicle => ({
            id,
            startLocation: createLoc(x, y),
            priceKm: 1,
        });

        const createOrder = (id: number, loadFactor = 1): Order => ({
            id,
            pickupLocation: createLoc(0, 0),
            deliveryLocation: createLoc(0, 0),
            loadFactor,
        });

        const createMatrices = (
            vehicles: Vehicle[],
            orders: Order[],
            distances: { v_o?: Record<string, number>; o_o?: Record<string, number> },
        ) => {
            const orderMap = new Map<number, number>();
            orders.forEach((o, i) => orderMap.set(o.id, i));

            const vStartMatrix: DistanceMatrix = vehicles.map((v, vIdx) =>
                orders.map((o, oIdx) => {
                    const key = `v${v.id}-o${o.id}`;
                    return distances.v_o?.[key] ?? 10;
                }),
            );

            const n = orders.length * 2;
            const distMatrix: DistanceMatrix = Array.from({ length: n }, (_, r) =>
                Array.from({ length: n }, (_, c) => {
                    const rType = r % 2 === 0 ? 'P' : 'D';
                    const rOrderIdx = Math.floor(r / 2);
                    const rOrderId = orders[rOrderIdx].id;

                    const cType = c % 2 === 0 ? 'P' : 'D';
                    const cOrderIdx = Math.floor(c / 2);
                    const cOrderId = orders[cOrderIdx].id;

                    const key = `o${rOrderId}${rType}-o${cOrderId}${cType}`;
                    return distances.o_o?.[key] ?? 10;
                }),
            );

            return { vStartMatrix, distMatrix };
        };

        it('should generate a valid route for a single order', () => {
            const vehicle = createVehicle(1, 0, 0);
            const order = createOrder(1);
            const problem: Problem = { vehicles: [vehicle], orders: [order] };

            const { vStartMatrix, distMatrix } = createMatrices([vehicle], [order], {
                v_o: { 'v1-o1': 5 },
                o_o: { 'o1P-o1D': 10 },
            });

            const solution = generateRCRS(problem, distMatrix, vStartMatrix, OptimizationTarget.EMPTY);

            expect(Object.keys(solution.routes)).toHaveLength(1);
            const route = solution.routes['1'];
            expect(route.stops).toHaveLength(2);
            expect(route.stops[0]).toEqual({ orderId: 1, type: 'pickup' });
            expect(route.stops[1]).toEqual({ orderId: 1, type: 'delivery' });

            expect(route.totalDistance).toBe(15);

            expect(route.emptyDistance).toBe(5);

            expect(route.totalPrice).toBe(15);
        });

        it('should handle load capacity constraints correctly', () => {
            const vehicle = createVehicle(1, 0, 0, 1.0);
            const o1 = createOrder(1, 2.0);
            const o2 = createOrder(2, 2.0);
            const o3 = createOrder(3, 0.5);

            const problem: Problem = { vehicles: [vehicle], orders: [o1, o2, o3] };

            const { vStartMatrix, distMatrix } = createMatrices([vehicle], [o1, o2, o3], {});

            const solution = generateRCRS(problem, distMatrix, vStartMatrix, OptimizationTarget.EMPTY);
            const route = solution.routes['1'];

            const hasO3 = route.stops.some(s => s.orderId === 3);
            expect(hasO3).toBe(false);

            const hasO1 = route.stops.some(s => s.orderId === 1);
            const hasO2 = route.stops.some(s => s.orderId === 2);
            expect(hasO1).toBe(true);
            expect(hasO2).toBe(true);
        });

        it('should calculate empty distance correctly for multi-stop routes', () => {
            const vehicle = createVehicle(1, 0, 0);
            const o1 = createOrder(1, 1);
            const o2 = createOrder(2, 1);

            const problem: Problem = { vehicles: [vehicle], orders: [o1, o2] };

            const { vStartMatrix, distMatrix } = createMatrices([vehicle], [o1, o2], {
                v_o: { 'v1-o1': 5, 'v1-o2': 100 },
                o_o: {
                    'o1P-o1D': 10,
                    'o1D-o2P': 20,
                    'o2P-o2D': 10,
                },
            });

            const solution = generateRCRS(problem, distMatrix, vStartMatrix, OptimizationTarget.EMPTY);
            const route = solution.routes['1'];

            const stopIds = route.stops.map(s => s.orderId);
            expect(stopIds).toContain(1);
            expect(stopIds).toContain(2);

            if (route.stops[0].orderId === 1) {
                expect(route.emptyDistance).toBe(25);
                expect(route.totalDistance).toBe(45);
            } else {
                expect(route.emptyDistance).toBe(25);
            }
        });

        it('should respect multiple vehicles', () => {
            const v1 = createVehicle(1, 0, 0);
            const v2 = createVehicle(2, 100, 100);

            const o1 = createOrder(1);
            const o2 = createOrder(2);

            const problem: Problem = { vehicles: [v1, v2], orders: [o1, o2] };

            const { vStartMatrix, distMatrix } = createMatrices([v1, v2], [o1, o2], {
                v_o: {
                    'v1-o1': 5,
                    'v1-o2': 1000,
                    'v2-o1': 1000,
                    'v2-o2': 5,
                },
            });

            const solution = generateRCRS(problem, distMatrix, vStartMatrix, OptimizationTarget.EMPTY);

            const r1 = solution.routes['1'];
            const r2 = solution.routes['2'];

            expect(r1.stops.some(s => s.orderId === 1)).toBe(true);
            expect(r1.stops.some(s => s.orderId === 2)).toBe(false);

            expect(r2.stops.some(s => s.orderId === 2)).toBe(true);
            expect(r2.stops.some(s => s.orderId === 1)).toBe(false);
        });

        it('should prioritize EMPTY distance target correctly', () => {
            const v1 = createVehicle(1, 0, 0);
            const v2 = createVehicle(2, 0, 0);
            const o1 = createOrder(1);

            const problem: Problem = { vehicles: [v1, v2], orders: [o1] };

            const { vStartMatrix, distMatrix } = createMatrices([v1, v2], [o1], {
                v_o: { 'v1-o1': 10, 'v2-o1': 50 },
                o_o: { 'o1P-o1D': 100 }, // Route 1 Internal
            });

            const solution = generateRCRS(problem, distMatrix, vStartMatrix, OptimizationTarget.EMPTY);

            const r1 = solution.routes['1'];
            const r2 = solution.routes['2'];

            expect(r1.stops.length).toBeGreaterThan(0);
            expect(r2.stops.length).toBe(0);

            expect(r1.emptyDistance).toBe(10);
        });
    });
}
