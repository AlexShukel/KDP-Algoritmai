import { DistanceCalculator } from '../types/algorithm';

const cache = new Map<string, number>();

const getCachedDistance = (hashFrom: string, hashTo: string) =>
    cache.get(`${hashFrom}.${hashTo}`) || cache.get(`${hashTo}.${hashFrom}`);

const toRadians = (degrees: number) => degrees * (Math.PI / 180);

export const greatCircleDistanceCalculator: DistanceCalculator = (from, to) => {
    const cachedDistance = getCachedDistance(from.hash, to.hash);
    if (cachedDistance) {
        return cachedDistance;
    }

    const lat1 = toRadians(from.latitude);
    const lon1 = toRadians(from.longitude);
    const lat2 = toRadians(to.latitude);
    const lon2 = toRadians(to.longitude);

    const distance =
        Math.acos(Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2)) * 6371;
    cache.set(`${from.hash}.${to.hash}`, distance);

    return distance;
};
