import { describe, it, expect } from 'vitest';
import { BruteForceAlgorithm as OptimizedAlgorithm } from './index';
import { BruteForceAlgorithm as UnoptimizedAlgorithm } from './unoptimized';
import { AlgorithmConfig } from '../../types/algorithm';
import { Location, Vehicle, Order, Problem } from '../../types/types';

const euclideanDistance = (a: Location, b: Location) => {
    return Math.sqrt(Math.pow(a.latitude - b.latitude, 2) + Math.pow(a.longitude - b.longitude, 2));
};

const config: AlgorithmConfig = {
    distanceCalc: euclideanDistance,
};

const makeLoc = (x: number, y: number): Location => ({ hash: `${x},${y}`, latitude: x, longitude: y });

const makeVehicle = (id: number, x: number, y: number, priceKm: number = 1): Vehicle => ({
    id,
    startLocation: makeLoc(x, y),
    priceKm,
});

const makeOrder = (id: number, px: number, py: number, dx: number, dy: number, loadFactor: number = 12): Order => ({
    id,
    pickupLocation: makeLoc(px, py),
    deliveryLocation: makeLoc(dx, dy),
    loadFactor,
});

const runComparison = (problem: Problem) => {
    const optimized = new OptimizedAlgorithm();
    const unoptimized = new UnoptimizedAlgorithm();

    const optResult = optimized.solve(problem, config);
    const unoptResult = unoptimized.solve(problem, config);

    expect(optResult.bestDistanceSolution.totalDistance).toBeCloseTo(unoptResult.bestDistanceSolution.totalDistance, 4);
    expect(optResult.bestEmptySolution.emptyDistance).toBeCloseTo(unoptResult.bestEmptySolution.emptyDistance, 4);
    expect(optResult.bestPriceSolution.totalPrice).toBeCloseTo(unoptResult.bestPriceSolution.totalPrice, 4);
};

describe('Brute Force Algorithms Equivalence', () => {
    it('should match on 1x1', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0)],
            orders: [makeOrder(10, 0, 10, 0, 20)],
            constraints: { maxTotalDistance: 100 },
        };
        runComparison(problem);
    });

    it('should match on 2x2', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0), makeVehicle(2, 100, 0)],
            orders: [makeOrder(1, 5, 0, 5, 5), makeOrder(2, 105, 0, 105, 5)],
            constraints: { maxTotalDistance: 1000 },
        };
        runComparison(problem);
    });

    it('should match on optimization goals conflict (price vs distance)', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0, 10), makeVehicle(2, 50, 0, 1)],
            orders: [makeOrder(1, 5, 0, 10, 0)],
            constraints: { maxTotalDistance: 1000 },
        };

        const optimized = new OptimizedAlgorithm();
        const unoptimized = new UnoptimizedAlgorithm();

        const optRes = optimized.solve(problem, config);
        const unoptRes = unoptimized.solve(problem, config);

        // Verify they are equal to each other
        expect(optRes.bestDistanceSolution.totalDistance).toBeCloseTo(unoptRes.bestDistanceSolution.totalDistance);
        expect(optRes.bestPriceSolution.totalPrice).toBeCloseTo(unoptRes.bestPriceSolution.totalPrice);

        // Best distance should use V1
        expect(optRes.bestDistanceSolution.routes[1]).toBeDefined();
        expect(optRes.bestDistanceSolution.routes[2]).toBeUndefined();
        // Best Price should use V2
        expect(optRes.bestPriceSolution.routes[2]).toBeDefined();
        expect(optRes.bestPriceSolution.routes[1]).toBeUndefined();
    });

    it('should return empty/infinite solutions when max distance is exceeded', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0)],
            orders: [makeOrder(1, 1000, 0, 2000, 0)],
            constraints: { maxTotalDistance: 50 },
        };

        const optimized = new OptimizedAlgorithm();
        const unoptimized = new UnoptimizedAlgorithm();

        const optRes = optimized.solve(problem, config);
        const unoptRes = unoptimized.solve(problem, config);

        expect(optRes.bestDistanceSolution.totalDistance).toBe(Infinity);
        expect(unoptRes.bestDistanceSolution.totalDistance).toBe(Infinity);
    });

    it('should match on 4x4', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0), makeVehicle(2, 0, 10), makeVehicle(3, 10, 0), makeVehicle(4, 10, 10)],
            orders: [
                makeOrder(1, 1, 1, 2, 2),
                makeOrder(2, 1, 9, 2, 8),
                makeOrder(3, 9, 1, 8, 2),
                makeOrder(4, 9, 9, 8, 8),
            ],
            constraints: { maxTotalDistance: 5000 },
        };

        runComparison(problem);
    });

    it('should match on 3x1', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0), makeVehicle(2, 10, 0), makeVehicle(3, 20, 0)],
            orders: [makeOrder(1, 5, 0, 5, 10)],
            constraints: { maxTotalDistance: 1000 },
        };
        runComparison(problem);
    });

    it('should match on 1x3', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0)],
            orders: [makeOrder(1, 2, 2, 3, 3), makeOrder(2, 4, 4, 5, 5), makeOrder(3, 10, 10, 11, 11)],
            constraints: { maxTotalDistance: 1000 },
        };
        runComparison(problem);
    });

    it('should match on 2x3', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0), makeVehicle(2, 50, 50)],
            orders: [makeOrder(1, 5, 5, 10, 10), makeOrder(2, 45, 45, 40, 40), makeOrder(3, 25, 25, 26, 26)],
            constraints: { maxTotalDistance: 1000 },
        };
        runComparison(problem);
    });

    it('should match on 3x2', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0), makeVehicle(2, 10, 10), makeVehicle(3, 20, 20)],
            orders: [makeOrder(1, 5, 5, 6, 6), makeOrder(2, 15, 15, 16, 16)],
            constraints: { maxTotalDistance: 1000 },
        };
        runComparison(problem);
    });

    it('should match on 3x3', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0), makeVehicle(2, 0, 20), makeVehicle(3, 20, 0)],
            orders: [makeOrder(1, 2, 2, 3, 3), makeOrder(2, 2, 18, 3, 17), makeOrder(3, 18, 2, 17, 3)],
            constraints: { maxTotalDistance: 1000 },
        };
        runComparison(problem);
    });

    it('should match on 5x2', () => {
        const problem: Problem = {
            vehicles: [
                makeVehicle(1, 0, 0),
                makeVehicle(2, 10, 10),
                makeVehicle(3, 20, 20),
                makeVehicle(4, 30, 30),
                makeVehicle(5, 40, 40),
            ],
            orders: [makeOrder(1, 5, 5, 6, 6), makeOrder(2, 35, 35, 36, 36)],
            constraints: { maxTotalDistance: 1000 },
        };
        runComparison(problem);
    });

    it('should match on 2x4', () => {
        const problem: Problem = {
            vehicles: [makeVehicle(1, 0, 0), makeVehicle(2, 100, 100)],
            orders: [
                makeOrder(1, 10, 0, 10, 10),
                makeOrder(2, 0, 10, 10, 10),
                makeOrder(3, 90, 100, 90, 90),
                makeOrder(4, 100, 90, 90, 90),
            ],
            constraints: { maxTotalDistance: 1000 },
        };
        runComparison(problem);
    });
});
