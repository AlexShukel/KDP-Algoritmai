/** Geographic location with Cartesian coordinates */
export interface Location {
    readonly latitude: number;
    readonly longitude: number;
}

/** Vehicle definition */
export interface Vehicle {
    readonly id: string;
    readonly startLocation: Location;
    readonly availableDate: Date;
    readonly priceKm: number;
    readonly capacity: number;
}

/** Order definition */
export interface Order {
    readonly id: string;
    readonly pickupLocation: Location;
    readonly deliveryLocation: Location;
    readonly distance: number;
    readonly price: number;
    readonly blockCount: number;
    readonly pickupDate: Date;
}

/** Problem instance containing all input data */
export interface ProblemInstance {
    readonly vehicles: ReadonlyArray<Vehicle>;
    readonly orders: ReadonlyArray<Order>;
    readonly maxDailyDistance: number; // Default: 600 km
    readonly maxTotalDistance: number; // Default: 1200 km
}

/** A stop in a route (either pickup or delivery) */
export interface RouteStop {
    readonly location: Location;
    readonly orderId: string;
    readonly type: 'pickup' | 'delivery';
    readonly arrivalDate: Date;
    readonly blockCount: number; // How many blocks where loaded or unloaded
}

/** Vehicle route solution */
export interface VehicleRoute {
    readonly stops: ReadonlyArray<RouteStop>;
    readonly totalDistance: number;
    readonly emptyDistance: number;
}

/** Complete solution to the VRPPD problem */
export interface Solution {
    routes: Record<string, VehicleRoute>;
    totalDistance: number;
    emptyDistance: number;
}
