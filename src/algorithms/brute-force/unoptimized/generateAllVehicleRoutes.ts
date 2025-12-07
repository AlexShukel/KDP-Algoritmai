/**
 * @module generate-routes
 * @description
 * This module generates all valid route permutations for a single vehicle
 * given a specific set of assigned orders.
 *
 * Algorithm:
 * It uses a recursive backtracking approach to generate permutations of
 * Pickup and Delivery stops. It employs pruning to enforce the constraint
 * that a Delivery stop cannot occur before its corresponding Pickup stop.
 *
 * Complexity:
 * The number of valid routes for n orders is given by the formula: (2n)! / 2^n.
 * - There are 2n total stops (pickups + deliveries).
 * - Total permutations are (2n)!.
 * - For every order pair, the constraint eliminates exactly half of the relative orderings.
 *
 * Complexity: O((2N)! / 2^N) where N is the number of orders in the vehicle.
 */

import { Location, Order, RouteStop } from '../../../types/types';

export type ExtendedRouteStop = RouteStop & {
    location: Location;
    loadFactor: number;
};

const partitionOrders = (orders: Order[], orderIds: Set<number>) => {
    const pickupLocations: ExtendedRouteStop[] = [];
    const deliveryLocations: ExtendedRouteStop[] = [];

    for (const orderId of orderIds) {
        const { pickupLocation, deliveryLocation, loadFactor } = orders.find(({ id }) => id === orderId)!;

        pickupLocations.push({
            type: 'pickup',
            orderId,
            location: pickupLocation,
            loadFactor,
        });

        deliveryLocations.push({
            type: 'delivery',
            orderId,
            location: deliveryLocation,
            loadFactor,
        });
    }

    return { pickupLocations, deliveryLocations };
};

export const generateAllVehicleRoutes = (orders: Order[], orderIds: Set<number>): ExtendedRouteStop[][] => {
    const { pickupLocations, deliveryLocations } = partitionOrders(orders, orderIds);
    if (pickupLocations.length !== deliveryLocations.length) {
        throw new Error('Pickup and delivery arrays must have the same length.');
    }

    const allLocations = [...pickupLocations, ...deliveryLocations];

    const routes: ExtendedRouteStop[][] = [];

    const backtrack = (
        currentRoute: ExtendedRouteStop[],
        remainingLocations: ExtendedRouteStop[],
        pickupCount: number,
        deliveryCount: number,
        inTransitItems: Set<number>,
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

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test('should generate correct number of vehicle routes', () => {
        const orderIds = new Set<number>([1, 2, 3]);
        const routes = generateAllVehicleRoutes(
            [
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
                    loadFactor: 0,
                },
            ],
            orderIds,
        );
        expect(routes.length).toBe(720 / 8); // (2N)! / 2^N
    });
}
