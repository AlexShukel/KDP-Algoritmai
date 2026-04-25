/**
 * Parity smoke: end-to-end sanity check of the TS↔Rust napi path.
 *
 * Loads one small problem from the existing problem bank, runs both Rust
 * solvers (`solvePSa`, `solveCea`) for each of the three objectives, prints
 * the resulting solution metrics, and asserts the responses are structurally
 * well formed (every order picked-up-then-delivered exactly once across the
 * solution).
 *
 * Run with: pnpm parity:smoke
 *
 * Designed to fail loudly on any silent breakage in the bridge so the
 * full-scale parity benchmark doesn't burn an hour producing garbage.
 */

import fs from 'fs';
import path from 'path';

import { solveCea, solvePSa } from 'napi-bridge';
import type { Problem, ProblemSolution } from 'napi-bridge';

const targets: Array<'EMPTY' | 'DISTANCE' | 'PRICE'> = ['EMPTY', 'DISTANCE', 'PRICE'];
const FIXTURE = path.resolve('problems/problems/3_3');

function pickFixture(dir: string): string {
    if (!fs.existsSync(dir)) {
        throw new Error(
            `Fixture dir not found: ${dir}. Did you unzip sample_problems.zip into ./problems?`,
        );
    }
    const entries = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    if (entries.length === 0) {
        throw new Error(`No .json fixtures under ${dir}`);
    }
    return path.join(dir, entries[0]);
}

function assertSolutionValid(problem: Problem, sol: ProblemSolution): void {
    const pickedUp = new Set<number>();
    const delivered = new Set<number>();

    for (const [vehicleId, route] of Object.entries(sol.routes)) {
        const vId = Number(vehicleId);
        if (!problem.vehicles.some(v => v.id === vId)) {
            throw new Error(`route key ${vehicleId} does not match any vehicle id`);
        }
        const seenInRoute = new Set<number>();
        for (const stop of route.stops) {
            if (stop.type === 'pickup') {
                if (seenInRoute.has(stop.orderId)) {
                    throw new Error(`order ${stop.orderId} picked up twice on vehicle ${vId}`);
                }
                seenInRoute.add(stop.orderId);
                if (pickedUp.has(stop.orderId)) {
                    throw new Error(`order ${stop.orderId} picked up across multiple vehicles`);
                }
                pickedUp.add(stop.orderId);
            } else {
                if (!seenInRoute.has(stop.orderId)) {
                    throw new Error(
                        `order ${stop.orderId} delivered before pickup on vehicle ${vId}`,
                    );
                }
                if (delivered.has(stop.orderId)) {
                    throw new Error(`order ${stop.orderId} delivered twice`);
                }
                delivered.add(stop.orderId);
            }
        }
    }

    if (pickedUp.size !== problem.orders.length || delivered.size !== problem.orders.length) {
        throw new Error(
            `solution does not cover all orders: pickedUp=${pickedUp.size}, delivered=${delivered.size}, expected=${problem.orders.length}`,
        );
    }
}

function fmt(n: number, places = 3): string {
    return n.toFixed(places);
}

async function main(): Promise<void> {
    const fixturePath = pickFixture(FIXTURE);
    const problem: Problem = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    console.log(
        `Smoke fixture: ${path.relative(process.cwd(), fixturePath)} (V=${problem.vehicles.length}, N=${problem.orders.length})\n`,
    );

    console.log('-- p-SA (multi-thread pipeline) --');
    for (const target of targets) {
        const t0 = performance.now();
        const solved = solvePSa(problem, target, { seed: 2026, threads: 4 });
        const elapsed = performance.now() - t0;
        assertSolutionValid(problem, solved.solution);

        console.log(
            `[${target.padEnd(8)}] ` +
                `dist=${fmt(solved.solution.totalDistance)} ` +
                `empty=${fmt(solved.solution.emptyDistance)} ` +
                `price=${fmt(solved.solution.totalPrice)} ` +
                `history=${solved.history.length} pts ` +
                `wall=${fmt(elapsed, 1)} ms`,
        );
    }

    console.log('\n-- CEA (Wang & Chen 2013) --');
    for (const target of targets) {
        const t0 = performance.now();
        // Tight budget keeps the smoke under a few seconds total.
        const solved = solveCea(problem, target, {
            seed: 2026,
            populationSize: 10,
            convCount: 50,
            wallTimeCapMs: 5000,
        });
        const elapsed = performance.now() - t0;
        assertSolutionValid(problem, solved.solution);

        console.log(
            `[${target.padEnd(8)}] ` +
                `dist=${fmt(solved.solution.totalDistance)} ` +
                `empty=${fmt(solved.solution.emptyDistance)} ` +
                `price=${fmt(solved.solution.totalPrice)} ` +
                `gens=${solved.generations} ` +
                `history=${solved.history.length} pts ` +
                `wall=${fmt(elapsed, 1)} ms`,
        );
    }

    console.log('\nOK — Rust p-SA and CEA both reachable via napi-bridge and producing valid solutions.');
}

main().catch(err => {
    console.error('Parity smoke failed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
