/**
 * @module generate-assignments
 * @description
 * This module implements an exhaustive strategy to generate all possible
 * assignments of Orders to Vehicles.
 *
 * Algorithm:
 * It uses a recursive combinatorial approach (Cartesian product) to distribute
 * every Order to exactly one Vehicle.
 *
 * Complexity:
 * The computational complexity is O(V^O), where V is the number of vehicles
 * and O is the number of orders.
 *
 * WARNING:
 * Due to the exponential growth rate, this function is strictly intended for
 * very small problem instances (e.g., validating solvers on inputs where
 * N <= 6). It is not suitable for production datasets.
 */

import cloneDeep from 'lodash/cloneDeep';
import { Order, Problem, Vehicle } from '../../types/types';

const getEmptyAssignment = (vehicles: Vehicle[]): Map<number, Set<number>> => {
    const out = new Map<number, Set<number>>();

    for (const { id } of vehicles) {
        out.set(id, new Set());
    }

    return out;
};

export const generateAllOrderAssignments = (orders: Order[], vehicles: Vehicle[]): Array<Map<number, Set<number>>> => {
    const allAssignments: Array<Map<number, Set<number>>> = [];

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

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const problemInstance: Problem = {
        constraints: {
            maxTotalDistance: 1200,
        },
        orders: [
            {
                id: 1,
                pickupLocation: {
                    hash: 'op1',
                    latitude: 0,
                    longitude: 0,
                },
                deliveryLocation: {
                    hash: 'od1',
                    latitude: 0,
                    longitude: 0,
                },
                price: 0,
                loadFactor: 0,
            },
            {
                id: 2,
                pickupLocation: {
                    hash: 'op2',
                    latitude: 0,
                    longitude: 0,
                },
                deliveryLocation: {
                    hash: 'od2',
                    latitude: 0,
                    longitude: 0,
                },
                price: 0,
                loadFactor: 0,
            },
            {
                id: 3,
                pickupLocation: {
                    hash: 'op3',
                    latitude: 0,
                    longitude: 0,
                },
                deliveryLocation: {
                    hash: 'od3',
                    latitude: 0,
                    longitude: 0,
                },
                price: 0,
                loadFactor: 0,
            },
        ],
        vehicles: [
            {
                id: 1,
                startLocation: {
                    hash: 'v1',
                    latitude: 0,
                    longitude: 0,
                },
                priceKm: 0,
            },
            {
                id: 2,
                startLocation: {
                    hash: 'v2',
                    latitude: 0,
                    longitude: 0,
                },
                priceKm: 0,
            },
        ],
    };

    const { orders, vehicles } = problemInstance;

    test('should generate correct number of order assignments', () => {
        const assignments = generateAllOrderAssignments(orders, vehicles);
        expect(assignments.length).toBe(vehicles.length ** orders.length); // M^N
    });
}
