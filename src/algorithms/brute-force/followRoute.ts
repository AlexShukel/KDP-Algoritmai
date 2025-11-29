/**
 * @module route-simulation
 * @description
 * This module acts as a simulator for a vehicle traversing a specific ordered route.
 *
 * Functionality:
 * 1. Iterates sequentially through stops (Pickups/Deliveries).
 * 2. Accumulates metrics: Total Distance, Empty Distance, Total Price.
 * 3. Validates hard constraints:
 *    - Vehicle Capacity (Load Factor <= 1.0)
 *    - Maximum Total Distance
 *
 * Complexity:
 * O(S) where S is the number of stops in the route (S = 2 * Orders).
 * The operation is linear relative to the route length.
 */

import { DistanceCalculator } from '../../types/algorithm';
import { RouteStop, Vehicle } from '../../types/types';
import { euclideanDistanceCalculator } from '../../utils/euclideanDistanceCalculator';
import { ExtendedRouteStop } from './generateAllVehicleRoutes';

export const BRUTE_FORCE_ERRORS = {
    CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
    MAX_DISTANCE_EXCEEDED: 'MAX_DISTANCE_EXCEEDED',
};

export const followRoute = (
    vehicle: Vehicle,
    locations: ExtendedRouteStop[],
    maxTotalDistance: number,
    distanceCalc: DistanceCalculator,
) => {
    if (locations.length === 0) {
        return { totalDistance: 0, emptyDistance: 0, totalPrice: 0, stops: [] };
    }

    let totalDistance = distanceCalc(vehicle.startLocation, locations[0].location);
    let emptyDistance = totalDistance;
    let currentLoad = 1 / locations[0].loadFactor;

    if (totalDistance > maxTotalDistance) {
        throw BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED;
    }

    if (currentLoad > 1) {
        throw BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED;
    }

    const stops: RouteStop[] = locations.slice(0, 1);

    const inTransit = new Set<number>();

    for (let i = 1; i < locations.length; ++i) {
        const currentDistance = distanceCalc(locations[i - 1].location, locations[i].location);
        totalDistance += currentDistance;

        if (totalDistance > maxTotalDistance) {
            throw BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED;
        }

        stops.push(locations[i]);

        if (locations[i].type === 'pickup') {
            currentLoad += 1 / locations[i].loadFactor;
        } else {
            currentLoad -= 1 / locations[i].loadFactor;
        }

        if (currentLoad > 1) {
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

    return { totalDistance, emptyDistance, totalPrice: totalDistance * vehicle.priceKm, stops };
};

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test('should throw capacity constraint error on first pickup location', () => {
        const vehicle: Vehicle = {
            priceKm: 10,
            id: 1,
            startLocation: {
                hash: 'v1',
                latitude: 0,
                longitude: 0,
            },
        };

        const locations: ExtendedRouteStop[] = [
            {
                type: 'pickup',
                location: {
                    hash: 'op1',
                    latitude: 0,
                    longitude: 0,
                },
                orderId: 1,
                loadFactor: 0.9,
            },
        ];

        expect(() => followRoute(vehicle, locations, 1200, euclideanDistanceCalculator)).toThrowError(
            BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED,
        );
    });

    test('should throw capacity constraint error on second pickup location', () => {
        const vehicle: Vehicle = {
            priceKm: 10,
            id: 1,
            startLocation: {
                hash: 'v1',
                latitude: 0,
                longitude: 0,
            },
        };

        const locations: ExtendedRouteStop[] = [
            {
                type: 'pickup',
                location: {
                    hash: 'op1',
                    latitude: 0,
                    longitude: 0,
                },
                orderId: 1,
                loadFactor: 1,
            },
            {
                type: 'pickup',
                location: {
                    hash: 'op2',
                    latitude: 0,
                    longitude: 0,
                },
                orderId: 2,
                loadFactor: 12,
            },
        ];

        expect(() => followRoute(vehicle, locations, 1200, euclideanDistanceCalculator)).toThrowError(
            BRUTE_FORCE_ERRORS.CAPACITY_EXCEEDED,
        );
    });

    test('should throw max distance constraint error on first pickup location', () => {
        const vehicle: Vehicle = {
            priceKm: 10,
            id: 1,
            startLocation: {
                hash: 'v1',
                latitude: 0,
                longitude: 0,
            },
        };

        const locations: ExtendedRouteStop[] = [
            {
                type: 'pickup',
                location: {
                    hash: 'op1',
                    latitude: 0,
                    longitude: 1200,
                },
                orderId: 1,
                loadFactor: 2,
            },
        ];

        expect(() => followRoute(vehicle, locations, 1199, euclideanDistanceCalculator)).toThrowError(
            BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED,
        );
    });

    test('should throw max distance constraint error on second pickup location', () => {
        const vehicle: Vehicle = {
            priceKm: 10,
            id: 1,
            startLocation: {
                hash: 'v1',
                latitude: 0,
                longitude: 0,
            },
        };

        const locations: ExtendedRouteStop[] = [
            {
                type: 'pickup',
                location: {
                    hash: 'op1',
                    latitude: 0,
                    longitude: 600,
                },
                orderId: 1,
                loadFactor: 2,
            },
            {
                type: 'pickup',
                location: {
                    hash: 'op2',
                    latitude: 0,
                    longitude: 1200,
                },
                orderId: 2,
                loadFactor: 2,
            },
        ];

        expect(() => followRoute(vehicle, locations, 1199, euclideanDistanceCalculator)).toThrowError(
            BRUTE_FORCE_ERRORS.MAX_DISTANCE_EXCEEDED,
        );
    });
}
