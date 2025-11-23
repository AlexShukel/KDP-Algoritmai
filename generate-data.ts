/**
 * @file generate-data.ts
 * @description
 * This script serves as the Data Seeding and ETL utility.
 *
 * Purposes:
 * 1. Ingests raw CSV data representing real-world shipping lanes.
 * 2. Transforms CSV rows into strictly typed `Order` objects, calculating geohashes and prices.
 * 3. Synthetically generates a large fleet of `Vehicle` objects scattered across Europe.
 * 4. Persists the normalized data into `data/orders_<ts>.json` and `data/vehicles_<ts>.json`.
 */

import csv from 'csv-parser';
import fs from 'fs';
import z from 'zod';
import Geohash from 'latlon-geohash';
import path from 'path';

import type { Order, Vehicle } from './src/types/types';

const getRandomFloat = (min: number, max: number) => {
    return Math.random() * (max - min) + min;
};

const getRandomPriceKm = () => {
    return getRandomFloat(1, 3);
};

const EuropeApproximateBounds = {
    minLat: 36.0,
    maxLat: 70.0,
    minLon: -10.0,
    maxLon: 30.0,
};

const getRandomEuropeCoords = () => {
    const lat = getRandomFloat(EuropeApproximateBounds.minLat, EuropeApproximateBounds.maxLat);
    const lon = getRandomFloat(EuropeApproximateBounds.minLon, EuropeApproximateBounds.maxLon);

    return {
        latitude: Number.parseFloat(lat.toFixed(6)),
        longitude: Number.parseFloat(lon.toFixed(6)),
    };
};

const seedDatasetSchema = z
    .object({
        ID: z.string().transform(val => Number.parseInt(val)),
        MODEL_LF: z.string().transform(val => Number.parseInt(val)),
        MODEL_NAME: z.string(),
        CRG_LOAD_LOC_ID: z.string(),
        COUNTRY_FROM: z.string(),
        CITY_FROM: z.string(),
        LAT_FROM: z.string().transform(val => Number.parseFloat(val)),
        LON_FROM: z.string().transform(val => Number.parseFloat(val)),
        CRG_DELIVERY_LOC_ID: z.string(),
        COUNTRY_TO: z.string(),
        CITY_TO: z.string(),
        LAT_TO: z.string().transform(val => Number.parseFloat(val)),
        LON_TO: z.string().transform(val => Number.parseFloat(val)),
        VEHICLE_QNTY: z.string().transform(val => Number.parseInt(val)),
        DISTANCE_KM: z.string().transform(val => Number.parseInt(val)),
    })
    .array();

const GEOHASH_PRECISION = 6;

const generateOrders = (seedDataset: z.infer<typeof seedDatasetSchema>): Order[] => {
    const orders: Order[] = [];

    for (const { ID, LAT_FROM, LON_FROM, LAT_TO, LON_TO, VEHICLE_QNTY, MODEL_LF, DISTANCE_KM } of seedDataset) {
        orders.push(
            ...[...new Array(VEHICLE_QNTY)].fill({
                id: ID,
                pickupLocation: {
                    hash: Geohash.encode(LAT_FROM, LON_FROM, GEOHASH_PRECISION),
                    latitude: LAT_FROM,
                    longitude: LON_FROM,
                },
                deliveryLocation: {
                    hash: Geohash.encode(LAT_TO, LON_TO, GEOHASH_PRECISION),
                    latitude: LAT_TO,
                    longitude: LON_TO,
                },
                loadFactor: MODEL_LF,
                price: DISTANCE_KM * getRandomPriceKm(),
            } satisfies Order),
        );
    }

    return orders;
};

const VEHICLES_N = 20000;
const generateVehicles = (): Vehicle[] => {
    const vehicles: Vehicle[] = new Array(VEHICLES_N);

    for (let i = 0; i < VEHICLES_N; ++i) {
        const { latitude, longitude } = getRandomEuropeCoords();

        vehicles[i] = {
            id: i + 1,
            priceKm: getRandomPriceKm(),
            startLocation: {
                hash: Geohash.encode(latitude, longitude, GEOHASH_PRECISION),
                latitude,
                longitude,
            },
        };
    }

    return vehicles;
};

const main = async () => {
    const raw: any[] = [];

    fs.createReadStream('seed-dataset.csv')
        .pipe(csv())
        .on('data', data => raw.push(data))
        .on('end', () => {
            const orders = generateOrders(seedDatasetSchema.parse(raw));
            const vehicles = generateVehicles();

            const timestamp = new Date().getTime();
            const dataDir = path.resolve(__dirname, 'data');
            fs.writeFileSync(path.resolve(dataDir, `orders_${timestamp}.json`), JSON.stringify(orders));
            fs.writeFileSync(path.resolve(dataDir, `vehicles_${timestamp}.json`), JSON.stringify(vehicles));
        });
};

main().catch(err => {
    console.error(err);
    process.exit(1);
});
