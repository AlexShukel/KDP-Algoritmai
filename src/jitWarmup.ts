import { performance } from 'perf_hooks';
import { Algorithm, AlgorithmConfig } from './types/algorithm';
import { Problem } from './types/types';

const warmupProblem: Problem = {
    vehicles: [
        {
            id: 18339,
            startLocation: {
                hash: 'u3791m',
                latitude: 52.23844249879656,
                longitude: 16.22867951860774,
            },
            priceKm: 1.4234837883546008,
        },
        {
            id: 14598,
            startLocation: {
                hash: 'u3s90g',
                latitude: 53.630658667073355,
                longitude: 17.617954481763828,
            },
            priceKm: 2.844237232576707,
        },
        {
            id: 9364,
            startLocation: {
                hash: 'u3nn3d',
                latitude: 51.7383936199445,
                longitude: 19.760333173322103,
            },
            priceKm: 1.5288609789232108,
        },
        {
            id: 1795,
            startLocation: {
                hash: 'u1xcrt',
                latitude: 53.68981100706981,
                longitude: 11.231459887207079,
            },
            priceKm: 2.3640730724502745,
        },
        {
            id: 4073,
            startLocation: {
                hash: 'u1se8f',
                latitude: 54.06867905044248,
                longitude: 6.371074290386435,
            },
            priceKm: 2.5980806635679703,
        },
        {
            id: 4194,
            startLocation: {
                hash: 'u3krx8',
                latitude: 53.35387765104596,
                longitude: 17.56171644378981,
            },
            priceKm: 1.190115059203958,
        },
        {
            id: 12397,
            startLocation: {
                hash: 'u3kv6u',
                latitude: 52.97641158571285,
                longitude: 18.054395551872805,
            },
            priceKm: 1.8515402015800684,
        },
        {
            id: 977,
            startLocation: {
                hash: 'sp0gt9',
                latitude: 40.00113923138665,
                longitude: 1.2987175759870322,
            },
            priceKm: 2.432212239055872,
        },
    ],
    orders: [
        {
            id: 2498,
            pickupLocation: {
                hash: 'u1rdjq',
                latitude: 52.420559,
                longitude: 10.786168,
            },
            deliveryLocation: {
                hash: 'u30u9s',
                latitude: 51.4390106,
                longitude: 12.3714685,
            },
            loadFactor: 7,
        },
        {
            id: 11143,
            pickupLocation: {
                hash: 'u0b1x4',
                latitude: 49.496622,
                longitude: 0.316745,
            },
            deliveryLocation: {
                hash: 'u0msmq',
                latitude: 47.18965,
                longitude: 7.973802,
            },
            loadFactor: 3,
        },
        {
            id: 3535,
            pickupLocation: {
                hash: 'u2kx33',
                latitude: 47.687609,
                longitude: 17.634682,
            },
            deliveryLocation: {
                hash: 'u1x0es',
                latitude: 53.5503426,
                longitude: 10.0006542,
            },
            loadFactor: 8,
        },
        {
            id: 897,
            pickupLocation: {
                hash: 'u14k10',
                latitude: 51.331438,
                longitude: 3.208329,
            },
            deliveryLocation: {
                hash: 'u355vw',
                latitude: 51.32109,
                longitude: 15.71148,
            },
            loadFactor: 8,
        },
        {
            id: 384,
            pickupLocation: {
                hash: 'u1mxsy',
                latitude: 53.387024,
                longitude: 7.952453,
            },
            deliveryLocation: {
                hash: 'u0rxc9',
                latitude: 47.775065,
                longitude: 10.617085,
            },
            loadFactor: 8,
        },
        {
            id: 10153,
            pickupLocation: {
                hash: 'u1rdk3',
                latitude: 52.435841,
                longitude: 10.742137,
            },
            deliveryLocation: {
                hash: 'u1m9r4',
                latitude: 52.2667,
                longitude: 8.05,
            },
            loadFactor: 7,
        },
        {
            id: 4692,
            pickupLocation: {
                hash: 'u09qd0',
                latitude: 48.959139,
                longitude: 1.855432,
            },
            deliveryLocation: {
                hash: 'u0jcze',
                latitude: 45.325157,
                longitude: 8.422767,
            },
            loadFactor: 8,
        },
        {
            id: 2564,
            pickupLocation: {
                hash: 'u3k4he',
                latitude: 52.4040031,
                longitude: 17.0754108,
            },
            deliveryLocation: {
                hash: 'u14sdw',
                latitude: 51.4515013,
                longitude: 3.6260715,
            },
            loadFactor: 6,
        },
    ],
};

export const jitWarmup = (algorithm: Algorithm, config: AlgorithmConfig) => {
    const start = performance.now();
    console.log('Warming up JIT compiler...');
    algorithm.solve(warmupProblem, config);
    const end = performance.now();
    console.log(`Warm-up completed in ${(end - start).toFixed(2)}ms`);
};
