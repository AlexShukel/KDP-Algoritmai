import { DistanceCalculator } from '../algorithms/interfaces';
import { Location } from '../types/problem';

export class GreatCircleDistanceCalculator implements DistanceCalculator {
    private toRadians = (degrees: number) => degrees * (Math.PI / 180);

    calculate(from: Location, to: Location): number {
        const lat1 = this.toRadians(from.latitude);
        const lon1 = this.toRadians(from.longitude);
        const lat2 = this.toRadians(to.latitude);
        const lon2 = this.toRadians(to.longitude);

        return (
            Math.acos(Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2)) * 6371
        );
    }
}

// Euclidean distance calculator only for testing purposes
export class EuclideanDistanceCalculator implements DistanceCalculator {
    calculate(from: Location, to: Location): number {
        return Math.sqrt(Math.pow(from.latitude - to.latitude, 2) + Math.pow(from.longitude - to.longitude, 2));
    }
}
