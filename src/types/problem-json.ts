import z from 'zod';

const locationJsonSchema = z.object({
    hash: z.string(),
    latitude: z.number(),
    longitude: z.number(),
});

export const vehicleJsonSchema = z.object({
    id: z.number(),
    startLocation: locationJsonSchema, // generated: in Europe
    priceKm: z.number(), // generated: in range [1; 3]
});

export type VehicleJson = z.infer<typeof vehicleJsonSchema>;

export const orderJsonSchema = z.object({
    id: z.number(),
    pickupLocation: locationJsonSchema,
    deliveryLocation: locationJsonSchema,
    price: z.number(), // generate randomized price from DISTANCE_KM with price_km in range [1; 3]
    loadFactor: z.number(),
});

export type OrderJson = z.infer<typeof orderJsonSchema>;

export const problemJsonSchema = z.object({
    vehicles: vehicleJsonSchema.array(),
    orders: orderJsonSchema.array(),
    constraints: z.object({
        maxDailyDistance: z.number(),
        maxTotalDistance: z.number(),
    }),
});

export type ProblemJson = z.infer<typeof problemJsonSchema>;
