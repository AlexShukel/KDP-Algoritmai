import { DistanceCalculator } from '../../types/algorithm';
import { Order, Vehicle } from '../../types/types';

export type DistanceMatrix = number[][];

export const buildDistanceMatrix = (orders: Order[], calc: DistanceCalculator): DistanceMatrix => {
    const n = orders.length * 2;
    const mat = Array.from({ length: n }, () => Array(n).fill(0));

    const getLoc = (index: number) => {
        const orderIndex = Math.floor(index / 2);
        return index % 2 === 0 ? orders[orderIndex].pickupLocation : orders[orderIndex].deliveryLocation;
    };

    for (let i = 0; i < n; ++i) {
        for (let j = 0; j < n; ++j) {
            if (i === j) {
                continue;
            }
            mat[i][j] = calc(getLoc(i), getLoc(j));
        }
    }
    return mat;
};

export const buildVehicleDistances = (
    vehicles: Vehicle[],
    orders: Order[],
    calc: DistanceCalculator,
): DistanceMatrix => {
    // [vehicleIdx][orderIdx] -> Distance from VehicleStart to OrderPickup
    return vehicles.map(v => orders.map(o => calc(v.startLocation, o.pickupLocation)));
};

if (import.meta.vitest) {
    const { describe, test, expect } = import.meta.vitest;

    // Test Helpers

    const mockEuclideanCalc: DistanceCalculator = (loc1, loc2) => {
        const dx = loc1.latitude - loc2.latitude;
        const dy = loc1.longitude - loc2.longitude;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const createLoc = (x: number, y: number) => ({ hash: `${x},${y}`, latitude: x, longitude: y });

    const createOrder = (id: number, px: number, py: number, dx: number, dy: number): Order => ({
        id,
        pickupLocation: createLoc(px, py),
        deliveryLocation: createLoc(dx, dy),
        loadFactor: 1,
    });

    const createVehicle = (id: number, x: number, y: number): Vehicle => ({
        id,
        startLocation: createLoc(x, y),
        priceKm: 1,
    });

    // Tests

    describe('buildDistanceMatrix', () => {
        test('should return empty matrix for no orders', () => {
            const mat = buildDistanceMatrix([], mockEuclideanCalc);
            expect(mat).toEqual([]);
        });

        test('should build 2x2 matrix for single order', () => {
            // Order 0: P(0,0) -> D(3,4) (Distance 5)
            const orders = [createOrder(1, 0, 0, 3, 4)];
            const mat = buildDistanceMatrix(orders, mockEuclideanCalc);

            expect(mat.length).toBe(2);
            // 0 -> 0 (P -> P)
            expect(mat[0][0]).toBe(0);
            // 0 -> 1 (P -> D)
            expect(mat[0][1]).toBe(5);
            // 1 -> 0 (D -> P)
            expect(mat[1][0]).toBe(5);
        });

        test('should correctly map indices for multiple orders', () => {
            // Index Mapping:
            // 0: Order 0 Pickup (0,0)
            // 1: Order 0 Delivery (0,0)
            // 2: Order 1 Pickup (10,0)
            // 3: Order 1 Delivery (10,0)
            const orders = [createOrder(1, 0, 0, 0, 0), createOrder(2, 10, 0, 10, 0)];

            const mat = buildDistanceMatrix(orders, mockEuclideanCalc);

            expect(mat.length).toBe(4); // 2 orders * 2 stops

            // Check distance from Order 0 Pickup (0,0) to Order 1 Pickup (10,0)
            // mat[0][2]
            expect(mat[0][2]).toBe(10);

            // Check distance from Order 1 Delivery (10,0) to Order 0 Pickup (0,0)
            // mat[3][0]
            expect(mat[3][0]).toBe(10);
        });

        test('should calculate all pairwise distances correctly', () => {
            // 0: P(0,0)
            // 1: D(0,10)
            // 2: P(10,0)
            // 3: D(10,10)
            const orders = [createOrder(1, 0, 0, 0, 10), createOrder(2, 10, 0, 10, 10)];

            const mat = buildDistanceMatrix(orders, mockEuclideanCalc);

            // 0->1 (Vertical line 10)
            expect(mat[0][1]).toBe(10);
            // 0->2 (Horizontal line 10)
            expect(mat[0][2]).toBe(10);
            // 0->3 (Diagonal sqrt(200) ≈ 14.14)
            expect(mat[0][3]).toBeCloseTo(14.142, 3);
        });
    });

    describe('buildVehicleDistances', () => {
        test('should return empty matrix for no vehicles', () => {
            const mat = buildVehicleDistances([], [createOrder(1, 0, 0, 1, 1)], mockEuclideanCalc);
            expect(mat).toEqual([]);
        });

        test('should calculate distance from Vehicle Start to Order Pickups ONLY', () => {
            const vehicles = [createVehicle(1, 0, 0)]; // At (0,0)
            const orders = [
                createOrder(1, 3, 4, 100, 100), // Pickup at (3,4) [Dist=5], Delivery Far Away
            ];

            const mat = buildVehicleDistances(vehicles, orders, mockEuclideanCalc);

            // Should be [ [5] ]
            expect(mat[0][0]).toBe(5);
            // Ensure it didn't calculate to delivery (which would be ~141)
            expect(mat[0][0]).not.toBeGreaterThan(100);
        });

        test('should handle multiple vehicles and orders', () => {
            const vehicles = [
                createVehicle(1, 0, 0), // V1 at origin
                createVehicle(2, 0, 10), // V2 at (0,10)
            ];
            const orders = [
                createOrder(1, 10, 0, 0, 0), // O1 Pickup at (10,0)
                createOrder(2, 0, 20, 0, 0), // O2 Pickup at (0,20)
            ];

            const mat = buildVehicleDistances(vehicles, orders, mockEuclideanCalc);

            // V1 -> O1 (0,0) -> (10,0) = 10
            expect(mat[0][0]).toBe(10);
            // V1 -> O2 (0,0) -> (0,20) = 20
            expect(mat[0][1]).toBe(20);

            // V2 -> O1 (0,10) -> (10,0) = sqrt(10^2 + 10^2) = 14.14
            expect(mat[1][0]).toBeCloseTo(14.142, 3);
            // V2 -> O2 (0,10) -> (0,20) = 10
            expect(mat[1][1]).toBe(10);
        });
    });
}
