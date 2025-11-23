import z from 'zod';

const locationJsonSchema = z.object({
    hash: z.string(),
    latitude: z.number(),
    longitude: z.number(),
});

export type Location = z.infer<typeof locationJsonSchema>;

export const vehicleJsonSchema = z.object({
    id: z.number(),
    startLocation: locationJsonSchema, // generated: in Europe
    priceKm: z.number(), // generated: in range [1; 3]
});

export type Vehicle = z.infer<typeof vehicleJsonSchema>;

export const orderJsonSchema = z.object({
    id: z.number(),
    pickupLocation: locationJsonSchema,
    deliveryLocation: locationJsonSchema,
    price: z.number(), // generate randomized price from DISTANCE_KM with price_km in range [1; 3]
    loadFactor: z.number(),
});

export type Order = z.infer<typeof orderJsonSchema>;

export const problemJsonSchema = z.object({
    vehicles: vehicleJsonSchema.array(),
    orders: orderJsonSchema.array(),
    constraints: z.object({
        maxTotalDistance: z.number(),
    }),
});

export type Problem = z.infer<typeof problemJsonSchema>;

const routeStopJsonSchema = z.object({
    orderId: z.number(),
    type: z.union([z.literal('pickup'), z.literal('delivery')]),
});

export type RouteStop = z.infer<typeof routeStopJsonSchema>;

const vehicleRouteJsonSchema = z.object({
    stops: routeStopJsonSchema.array(),
    totalDistance: z.number(),
    emptyDistance: z.number(),
    totalPrice: z.number(),
});

export type VehicleRoute = z.infer<typeof vehicleRouteJsonSchema>;

const problemSolutionJsonSchema = z.object({
    routes: z.record(z.number(), vehicleRouteJsonSchema),
    totalDistance: z.number(),
    emptyDistance: z.number(),
    totalPrice: z.number(),
});

export type ProblemSolution = z.infer<typeof problemSolutionJsonSchema>;
