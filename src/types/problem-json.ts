interface LocationJSON {
    latitude: number;
    longitude: number;
}

interface VehicleJSON {
    id: string;
    startLocation: LocationJSON;
    availableDate: string;
    priceKm: number;
    capacity: number;
}

export interface OrderJSON {
    id: string;
    pickupLocation: LocationJSON;
    deliveryLocation: LocationJSON;
    price: number;
    blockCount: number;
    pickupDate: string;
}

interface ConstraintsJSON {
    maxDailyDistance: number;
    maxTotalDistance: number;
}

export interface ProblemJSON {
    vehicles: VehicleJSON[];
    orders: OrderJSON[];
    constraints: ConstraintsJSON;
}
