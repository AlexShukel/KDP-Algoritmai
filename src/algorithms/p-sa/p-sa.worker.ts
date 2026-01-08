import { parentPort } from 'worker_threads';
import {
    OptimizationTarget,
    Problem,
    ProblemSolution,
    SimulatedAnnealingConfig,
    Vehicle,
    VehicleRoute,
} from '../../types';
import { DistanceMatrix } from '../../utils/DistanceMatrix';

// Configuration
let CONFIG: SimulatedAnnealingConfig = {
    initialTemp: 1500,
    coolingRate: 0.99,
    minTemp: 0.1,
    maxIterations: 10000,
    batchSize: 50,
    syncInterval: 200,
    weights: { shift: 0.4, swap: 0.3, shuffle: 0.3 },
};

// State
let target: OptimizationTarget;
let problem: Problem;
let distMatrix: DistanceMatrix;
let vehicleStartMatrix: DistanceMatrix;
let orderMap: Map<number, number>;

let currentSolution: ProblemSolution;
let currentEnergy: number;
let bestLocalSolution: ProblemSolution;
let bestLocalEnergy: number;
let temperature: number;
let iterationCount = 0;
let isRunning = false;

if (parentPort) {
    parentPort.on('message', msg => {
        switch (msg.type) {
            case 'INIT':
                initialize(msg.data);
                startAnnealing();
                break;

            case 'INFLUENCE_UPDATE':
                handleInfluence(msg.solution, msg.energy);
                break;
        }
    });
}

if (parentPort) {
    parentPort.on('message', msg => {
        switch (msg.type) {
            case 'INIT':
                initialize(msg.data);
                startAnnealing();
                break;

            case 'INFLUENCE_UPDATE':
                handleInfluence(msg.solution, msg.energy);
                break;
        }
    });
}

function initialize(data: any) {
    target = data.target;
    problem = data.problem;
    distMatrix = data.distMatrix;
    vehicleStartMatrix = data.vehicleStartMatrix;

    if (data.config) {
        CONFIG = { ...CONFIG, ...data.config };
    }

    currentSolution = cloneSolution(data.initialSolution);
    temperature = CONFIG.initialTemp;

    orderMap = new Map();
    problem.orders.forEach((o, i) => orderMap.set(o.id, i));

    currentEnergy = calculateEnergy(currentSolution);
    bestLocalSolution = cloneSolution(currentSolution);
    bestLocalEnergy = currentEnergy;
}

function handleInfluence(neighborSolution: ProblemSolution, neighborEnergy: number) {
    if (neighborEnergy < currentEnergy) {
        // 1. Adopt the better solution
        currentSolution = cloneSolution(neighborSolution);
        currentEnergy = neighborEnergy;

        // 2. Perturb it immediately to prevent cloning.
        const mutated = generateNeighbor(currentSolution);
        if (isValidSolution(mutated)) {
            currentSolution = mutated;
            currentEnergy = calculateEnergy(mutated);
        }

        // 3. Update personal best if applicable
        if (currentEnergy < bestLocalEnergy) {
            bestLocalSolution = cloneSolution(currentSolution);
            bestLocalEnergy = currentEnergy;
        }

        // 4. Re-heat slightly
        temperature = Math.max(temperature, 50);
    }
}

function startAnnealing() {
    if (isRunning) return;
    isRunning = true;
    runBatch();
}

/**
 * Executes a batch of iterations, then pauses to allow the Event Loop
 * to process incoming INFLUENCE_UPDATE message.
 */
function runBatch() {
    if (!isRunning) {
        return;
    }

    // Run a chunk of iterations synchronously
    for (let i = 0; i < CONFIG.batchSize; ++i) {
        performIteration();
        ++iterationCount;

        if (iterationCount >= CONFIG.maxIterations || temperature < CONFIG.minTemp) {
            finish();
            return;
        }
    }

    // Sync logic
    if (iterationCount % (CONFIG.batchSize * CONFIG.syncInterval) === 0) {
        parentPort?.postMessage({
            type: 'SYNC_REPORT',
            energy: bestLocalEnergy,
            solution: bestLocalSolution,
        });
    }

    // Schedule next batch on the next tick of the Event loop
    setImmediate(runBatch);
}

function performIteration() {
    // 1. Generate neighbor
    const neighbor = generateNeighbor(currentSolution);
    const neighborEnergy = calculateEnergy(neighbor);

    // 2. Acceptance probability
    const delta = neighborEnergy - currentEnergy;

    if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
        currentSolution = neighbor;
        currentEnergy = neighborEnergy;

        if (currentEnergy < bestLocalEnergy) {
            bestLocalSolution = cloneSolution(currentSolution);
            bestLocalEnergy = currentEnergy;
        }
    }

    // 3. Cool down
    temperature *= CONFIG.coolingRate;
}

function finish() {
    isRunning = false;
    parentPort?.postMessage({
        type: 'DONE',
        energy: bestLocalEnergy,
        solution: bestLocalSolution,
    });
}

function calculateEnergy(solution: ProblemSolution): number {
    if (!isValidSolution(solution)) {
        return Infinity;
    }

    switch (target) {
        case OptimizationTarget.EMPTY:
            return solution.emptyDistance;
        case OptimizationTarget.DISTANCE:
            return solution.totalDistance;
        case OptimizationTarget.PRICE:
            return solution.totalPrice;
    }
}

function isValidSolution(solution: ProblemSolution): boolean {
    for (const vKey in solution.routes) {
        const route = solution.routes[vKey];
        const vId = parseInt(vKey);
        const vehicle = problem.vehicles.find(v => v.id === vId);
        if (vehicle && !checkRouteConstraints(route, vehicle)) {
            return false;
        }
    }
    return true;
}

function checkRouteConstraints(route: VehicleRoute, vehicle: Vehicle): boolean {
    if (route.stops.length === 0) {
        return true;
    }

    let currentLoad = 0;
    const MAX_LOAD = 1.0;

    const pickedUp = new Set<number>();

    for (let i = 0; i < route.stops.length; i++) {
        const stop = route.stops[i];
        const order = problem.orders.find(o => o.id === stop.orderId)!;

        const loadChange = 1 / order.loadFactor;
        if (stop.type === 'pickup') {
            currentLoad += loadChange;
            pickedUp.add(order.id);
        } else {
            currentLoad -= loadChange;
            if (!pickedUp.has(order.id)) {
                return false;
            }
        }
        if (currentLoad > MAX_LOAD) {
            return false;
        }
    }

    return Math.abs(currentLoad) < Number.EPSILON;
}

// OPERATORS

function generateNeighbor(current: ProblemSolution): ProblemSolution {
    const solution = cloneSolution(current);
    const vIds = Object.keys(solution.routes).map(Number);
    const nonEmpty = vIds.filter(id => solution.routes[id].stops.length > 0);

    if (nonEmpty.length === 0) {
        return solution;
    }

    const r = Math.random();

    // 1. SHIFT (40%)
    if (r < CONFIG.weights!.shift) {
        const v1 = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
        const r1 = solution.routes[v1];
        if (r1.stops.length === 0) return solution;

        const oId = r1.stops[Math.floor(Math.random() * r1.stops.length)].orderId;
        r1.stops = r1.stops.filter(s => s.orderId !== oId);

        const v2 = vIds[Math.floor(Math.random() * vIds.length)];
        const r2 = solution.routes[v2];

        const pIdx = Math.floor(Math.random() * (r2.stops.length + 1));
        r2.stops.splice(pIdx, 0, { orderId: oId, type: 'pickup' });

        const maxD = r2.stops.length;
        const dIdx = Math.floor(Math.random() * (maxD - pIdx)) + pIdx + 1;
        r2.stops.splice(dIdx, 0, { orderId: oId, type: 'delivery' });
    }
    // 2. SWAP (30%)
    else if (r < CONFIG.weights!.shift + CONFIG.weights!.swap && nonEmpty.length >= 2) {
        const v1 = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
        let v2 = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
        // Try to find different vehicle
        let tries = 0;
        while (v1 === v2 && tries < 5) {
            v2 = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
            ++tries;
        }

        const r1 = solution.routes[v1];
        const r2 = solution.routes[v2];

        const o1 = r1.stops[Math.floor(Math.random() * r1.stops.length)].orderId;
        const o2 = r2.stops[Math.floor(Math.random() * r2.stops.length)].orderId;

        if (o1 !== o2) {
            r1.stops = r1.stops.filter(s => s.orderId !== o1);
            r2.stops = r2.stops.filter(s => s.orderId !== o2);

            // Simplified append for swap stability
            r1.stops.push({ orderId: o2, type: 'pickup' }, { orderId: o2, type: 'delivery' });
            r2.stops.push({ orderId: o1, type: 'pickup' }, { orderId: o1, type: 'delivery' });
        }
    }
    // 3. INTRA-SHUFFLE (30%)
    else {
        const v = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
        const route = solution.routes[v];
        if (route.stops.length >= 4) {
            const orders = Array.from(new Set(route.stops.map(s => s.orderId)));
            // Simple shuffle of order sequence
            for (let i = orders.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [orders[i], orders[j]] = [orders[j], orders[i]];
            }
            route.stops = [];
            orders.forEach(oid => {
                route.stops.push({ orderId: oid, type: 'pickup' });
                route.stops.push({ orderId: oid, type: 'delivery' });
            });
        }
    }

    recalculateStats(solution);
    return solution;
}

function recalculateStats(sol: ProblemSolution) {
    let totalDist = 0,
        totalEmpty = 0,
        totalPrice = 0;

    for (const vKey in sol.routes) {
        const route = sol.routes[vKey];
        const vId = parseInt(vKey);
        const vehicle = problem.vehicles.find(v => v.id === vId)!;

        let d = 0,
            e = 0;

        if (route.stops.length > 0) {
            const vIdx = problem.vehicles.indexOf(vehicle);
            const first = route.stops[0];
            const firstO = problem.orders.find(o => o.id === first.orderId)!;
            const startD = vehicleStartMatrix[vIdx][orderMap.get(firstO.id)!];

            d += startD;
            e += startD;

            let load = 1 / firstO.loadFactor; // Pickup

            for (let i = 0; i < route.stops.length - 1; i++) {
                const s1 = route.stops[i];
                const s2 = route.stops[i + 1];
                const o1 = problem.orders.find(o => o.id === s1.orderId)!;
                const o2 = problem.orders.find(o => o.id === s2.orderId)!;

                const u = orderMap.get(o1.id)! * 2 + (s1.type === 'delivery' ? 1 : 0);
                const v = orderMap.get(o2.id)! * 2 + (s2.type === 'delivery' ? 1 : 0);

                const leg = distMatrix[u][v];
                d += leg;
                if (Math.abs(load) < 0.001) e += leg;

                if (s2.type === 'pickup') load += 1 / o2.loadFactor;
                else load -= 1 / o2.loadFactor;
            }
        }
        route.totalDistance = d;
        route.emptyDistance = e;
        route.totalPrice = d * vehicle.priceKm;

        totalDist += d;
        totalEmpty += e;
        totalPrice += route.totalPrice;
    }
    sol.totalDistance = totalDist;
    sol.emptyDistance = totalEmpty;
    sol.totalPrice = totalPrice;
}

function cloneSolution(solution: ProblemSolution): ProblemSolution {
    return structuredClone(solution);
}
