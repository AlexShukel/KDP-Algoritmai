import { DistanceCalculator } from '../types';

const toRadians = (degrees: number) => degrees * (Math.PI / 180);

export const greatCircleDistanceCalculator: DistanceCalculator = (from, to) => {
    const lat1 = toRadians(from.latitude);
    const lon1 = toRadians(from.longitude);
    const lat2 = toRadians(to.latitude);
    const lon2 = toRadians(to.longitude);

    return Math.acos(Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2)) * 6371;
};
