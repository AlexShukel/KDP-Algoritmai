import { DistanceCalculator } from '../types/algorithm';

export const euclideanDistanceCalculator: DistanceCalculator = (from, to) => {
    return Math.sqrt(Math.pow(from.latitude - to.latitude, 2) + Math.pow(from.longitude - to.longitude, 2));
};
