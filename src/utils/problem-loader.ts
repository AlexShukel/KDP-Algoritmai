import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { ProblemInstance, Vehicle, Order } from '../types/problem';
import { ProblemJSON } from '../types/problem-json';
import { DateUtils } from './date-utils';
import { EuclideanDistanceCalculator } from './distance';

export interface LoadedProblem {
    instance: ProblemInstance;
    metadata: ProblemMetadata;
}

export interface ProblemMetadata {
    filename: string;
    vehicleCount: number;
    orderCount: number;
}

export class ProblemLoader {
    private distanceCalc = new EuclideanDistanceCalculator();

    async loadFromDirectory(directoryPath: string): Promise<LoadedProblem[]> {
        const problems: LoadedProblem[] = [];

        try {
            const files = await readdir(directoryPath);
            const jsonFiles = files.filter(file => file.endsWith('.json'));

            console.log(`Found ${jsonFiles.length} problem files in "${directoryPath}"`);

            for (const file of jsonFiles) {
                try {
                    const problem = await this.loadFromFile(path.join(directoryPath, file));
                    problems.push(problem);
                    console.log(`\tLoaded ${file} successfully`);
                } catch (error) {
                    console.error(`\tFailed to load ${file}:`, error);
                }
            }
        } catch (error) {
            console.error(`Failed to read directory "${directoryPath}"`);
            throw error;
        }

        return problems;
    }

    async loadFromFile(filePath: string): Promise<LoadedProblem> {
        try {
            const content = await readFile(filePath, 'utf-8');
            const data: ProblemJSON = JSON.parse(content);

            const instance = this.convertToInstance(data);
            const metadata = this.extractMetadata(data, filePath);

            return { instance, metadata };
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
            }
            throw new Error(`Failed to load problem from ${filePath}: ${error}`);
        }
    }

    public convertToInstance(data: ProblemJSON): ProblemInstance {
        const vehicles: Vehicle[] = data.vehicles.map(v => ({
            id: v.id,
            startLocation: v.startLocation,
            availableDate: DateUtils.parseUTC(v.availableDate),
            priceKm: v.priceKm,
            capacity: v.capacity,
        }));

        const orders: Order[] = data.orders.map(o => {
            const pickupLocation = o.pickupLocation;
            const deliveryLocation = o.deliveryLocation;
            const distance = this.distanceCalc.calculate(pickupLocation, deliveryLocation);

            return {
                id: o.id,
                pickupLocation,
                deliveryLocation,
                distance,
                price: o.price,
                blockCount: o.blockCount,
                pickupDate: DateUtils.parseUTC(o.pickupDate),
            };
        });

        return {
            vehicles,
            orders,
            maxDailyDistance: data.constraints.maxDailyDistance,
            maxTotalDistance: data.constraints.maxTotalDistance,
        };
    }

    private extractMetadata(data: ProblemJSON, filePath: string): ProblemMetadata {
        const filename = path.basename(filePath, '.json');

        return {
            filename,
            vehicleCount: data.vehicles.length,
            orderCount: data.orders.length,
        };
    }
}
