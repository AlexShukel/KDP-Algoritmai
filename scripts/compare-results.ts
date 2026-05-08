/**
 * Compare two harness output JSONs and emit a parity report.
 *
 * Usage:
 *   tsx scripts/compare-results.ts <baseline.json> <candidate.json> [--out report.md]
 *
 * Inputs are arrays of `BenchmarkRecord` (the shape produced by `pnpm start`).
 * Records are paired by (problemPath, optimizationTarget, runIndex), which
 * means the two inputs must come from the same problem set and identical
 * `HEURISTIC_REPETITIONS` setting. Mismatched runs are reported in the diag
 * section but excluded from per-bucket statistics.
 *
 * Output:
 *   - Per (size class, objective) markdown tables: mean energy on each side,
 *     mean RPD relative to the per-pair winner, mean wall time, and runtime
 *     speedup of candidate vs baseline.
 *   - A "verdict" line per objective (which side wins on average across all
 *     paired runs, and by how much).
 *
 * Designed for the Phase 1.1 distributional-parity check (PLAN.md §1.1):
 * baseline = JS p-SA (`p-sa-js`), candidate = Rust p-SA (`p-sa-rust`).
 */

import fs from 'fs';
import path from 'path';
import process from 'process';

interface SolutionMetrics {
    totalDistance: number;
    emptyDistance: number;
    totalPrice: number;
}

interface BenchmarkRecord {
    problemPath: string;
    problemSize: { vehicles: number; orders: number };
    optimizationTarget: 'EMPTY' | 'DISTANCE' | 'PRICE';
    runIndex: number;
    execTime: number;
    metrics: SolutionMetrics;
    isBatchResult: boolean;
}

const TARGETS = ['EMPTY', 'DISTANCE', 'PRICE'] as const;
type Target = (typeof TARGETS)[number];

function readRecords(file: string): BenchmarkRecord[] {
    const raw = fs.readFileSync(file, 'utf-8');
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records)) {
        throw new Error(`${file}: expected an array of benchmark records, got ${typeof records}`);
    }
    return records as BenchmarkRecord[];
}

function recordKey(r: BenchmarkRecord): string {
    return `${r.problemPath}::${r.optimizationTarget}::${r.runIndex}`;
}

function energyFor(r: BenchmarkRecord): number {
    switch (r.optimizationTarget) {
        case 'EMPTY':
            return r.metrics.emptyDistance;
        case 'DISTANCE':
            return r.metrics.totalDistance;
        case 'PRICE':
            return r.metrics.totalPrice;
    }
}

function sizeBucket(size: { vehicles: number; orders: number }): string {
    return `${size.vehicles}×${size.orders}`;
}

interface PairStats {
    size: string;
    target: Target;
    pairs: number;
    baselineEnergy: number;
    candidateEnergy: number;
    baselineRpd: number;
    candidateRpd: number;
    baselineWallMs: number;
    candidateWallMs: number;
}

function aggregate(
    baseline: BenchmarkRecord[],
    candidate: BenchmarkRecord[],
): {
    perBucket: PairStats[];
    overallByTarget: Record<Target, PairStats>;
    diag: { unmatchedBaseline: number; unmatchedCandidate: number };
} {
    const baselineByKey = new Map<string, BenchmarkRecord>();
    for (const r of baseline) baselineByKey.set(recordKey(r), r);
    const candidateByKey = new Map<string, BenchmarkRecord>();
    for (const r of candidate) candidateByKey.set(recordKey(r), r);

    type Sum = {
        n: number;
        baseE: number;
        candE: number;
        baseRpd: number;
        candRpd: number;
        baseT: number;
        candT: number;
    };
    const empty = (): Sum => ({ n: 0, baseE: 0, candE: 0, baseRpd: 0, candRpd: 0, baseT: 0, candT: 0 });

    const perKey = new Map<string, Sum>();
    const perTarget: Record<Target, Sum> = { EMPTY: empty(), DISTANCE: empty(), PRICE: empty() };

    let unmatchedBaseline = 0;
    let unmatchedCandidate = 0;

    for (const [key, b] of baselineByKey) {
        const c = candidateByKey.get(key);
        if (!c) {
            ++unmatchedBaseline;
            continue;
        }
        const eB = energyFor(b);
        const eC = energyFor(c);
        const winner = Math.min(eB, eC);
        const denom = winner > 0 ? winner : 1e-9;
        const rpdB = (eB - winner) / denom;
        const rpdC = (eC - winner) / denom;

        const bucketKey = `${sizeBucket(b.problemSize)}::${b.optimizationTarget}`;
        let agg = perKey.get(bucketKey);
        if (!agg) {
            agg = empty();
            perKey.set(bucketKey, agg);
        }
        agg.n += 1;
        agg.baseE += eB;
        agg.candE += eC;
        agg.baseRpd += rpdB;
        agg.candRpd += rpdC;
        agg.baseT += b.execTime;
        agg.candT += c.execTime;

        const tot = perTarget[b.optimizationTarget];
        tot.n += 1;
        tot.baseE += eB;
        tot.candE += eC;
        tot.baseRpd += rpdB;
        tot.candRpd += rpdC;
        tot.baseT += b.execTime;
        tot.candT += c.execTime;
    }

    for (const key of candidateByKey.keys()) {
        if (!baselineByKey.has(key)) ++unmatchedCandidate;
    }

    const toStats = (size: string, target: Target, s: Sum): PairStats => ({
        size,
        target,
        pairs: s.n,
        baselineEnergy: s.n ? s.baseE / s.n : NaN,
        candidateEnergy: s.n ? s.candE / s.n : NaN,
        baselineRpd: s.n ? s.baseRpd / s.n : NaN,
        candidateRpd: s.n ? s.candRpd / s.n : NaN,
        baselineWallMs: s.n ? s.baseT / s.n : NaN,
        candidateWallMs: s.n ? s.candT / s.n : NaN,
    });

    const perBucket: PairStats[] = [];
    for (const [bucketKey, s] of perKey) {
        const [size, target] = bucketKey.split('::') as [string, Target];
        perBucket.push(toStats(size, target, s));
    }
    perBucket.sort((a, b) => {
        if (a.target !== b.target) return TARGETS.indexOf(a.target) - TARGETS.indexOf(b.target);
        return a.size.localeCompare(b.size, undefined, { numeric: true });
    });

    const overallByTarget = {
        EMPTY: toStats('overall', 'EMPTY', perTarget.EMPTY),
        DISTANCE: toStats('overall', 'DISTANCE', perTarget.DISTANCE),
        PRICE: toStats('overall', 'PRICE', perTarget.PRICE),
    };

    return { perBucket, overallByTarget, diag: { unmatchedBaseline, unmatchedCandidate } };
}

function fmt(n: number, places = 3): string {
    return Number.isFinite(n) ? n.toFixed(places) : '—';
}

function fmtPct(frac: number): string {
    return Number.isFinite(frac) ? `${(frac * 100).toFixed(2)}%` : '—';
}

function speedup(baseT: number, candT: number): string {
    if (!Number.isFinite(baseT) || !Number.isFinite(candT) || candT <= 0) return '—';
    return `${(baseT / candT).toFixed(2)}×`;
}

function buildReport(
    baselineLabel: string,
    candidateLabel: string,
    perBucket: PairStats[],
    overallByTarget: Record<Target, PairStats>,
    diag: { unmatchedBaseline: number; unmatchedCandidate: number },
): string {
    const lines: string[] = [];
    lines.push(`# p-SA parity report: ${baselineLabel} vs ${candidateLabel}\n`);
    lines.push(
        `Generated ${new Date().toISOString()}. Pairs are formed by (problemPath, optimizationTarget, runIndex). ` +
            `RPD is computed against the better of the two implementations on the same paired run, so RPD = 0% means a tie.\n`,
    );

    if (diag.unmatchedBaseline || diag.unmatchedCandidate) {
        lines.push(
            `> ⚠ Unmatched records — baseline-only: ${diag.unmatchedBaseline}, candidate-only: ${diag.unmatchedCandidate}.\n`,
        );
    }

    lines.push('## Overall (averaged across the full paired set)\n');
    lines.push(`| Objective | Pairs | ${baselineLabel} mean RPD | ${candidateLabel} mean RPD | ${baselineLabel} mean ms | ${candidateLabel} mean ms | Speedup |`);
    lines.push(`|---|---:|---:|---:|---:|---:|---:|`);
    for (const target of TARGETS) {
        const s = overallByTarget[target];
        lines.push(
            `| ${target} | ${s.pairs} | ${fmtPct(s.baselineRpd)} | ${fmtPct(s.candidateRpd)} | ${fmt(s.baselineWallMs, 1)} | ${fmt(s.candidateWallMs, 1)} | ${speedup(s.baselineWallMs, s.candidateWallMs)} |`,
        );
    }
    lines.push('');

    lines.push('## Per size × objective\n');
    lines.push(`| Size | Objective | Pairs | ${baselineLabel} mean energy | ${candidateLabel} mean energy | ${baselineLabel} RPD | ${candidateLabel} RPD | ${baselineLabel} ms | ${candidateLabel} ms | Speedup |`);
    lines.push(`|---|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
    for (const s of perBucket) {
        lines.push(
            `| ${s.size} | ${s.target} | ${s.pairs} | ${fmt(s.baselineEnergy)} | ${fmt(s.candidateEnergy)} | ${fmtPct(s.baselineRpd)} | ${fmtPct(s.candidateRpd)} | ${fmt(s.baselineWallMs, 1)} | ${fmt(s.candidateWallMs, 1)} | ${speedup(s.baselineWallMs, s.candidateWallMs)} |`,
        );
    }
    lines.push('');

    lines.push('## Verdict per objective\n');
    for (const target of TARGETS) {
        const s = overallByTarget[target];
        if (s.pairs === 0) {
            lines.push(`- **${target}**: no paired records, cannot compare.`);
            continue;
        }
        const candWinsRpd = s.candidateRpd < s.baselineRpd;
        const winner = candWinsRpd ? candidateLabel : baselineLabel;
        const margin = Math.abs(s.candidateRpd - s.baselineRpd);
        const speed = speedup(s.baselineWallMs, s.candidateWallMs);
        lines.push(
            `- **${target}**: quality winner = **${winner}** (Δ mean RPD = ${fmtPct(margin)}); candidate runtime ${speed} relative to baseline.`,
        );
    }
    lines.push('');

    return lines.join('\n');
}

function parseArgs(argv: string[]): { baseline: string; candidate: string; out?: string } {
    const positional: string[] = [];
    let out: string | undefined;
    for (let i = 0; i < argv.length; ++i) {
        const a = argv[i];
        if (a === '--out') {
            out = argv[++i];
        } else if (a.startsWith('--')) {
            throw new Error(`Unknown flag: ${a}`);
        } else {
            positional.push(a);
        }
    }
    if (positional.length !== 2) {
        throw new Error(
            'Usage: tsx scripts/compare-results.ts <baseline.json> <candidate.json> [--out report.md]',
        );
    }
    return { baseline: positional[0], candidate: positional[1], out };
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const baselineLabel = path.basename(args.baseline).replace(/^benchmark-results-|\.json$/g, '');
    const candidateLabel = path.basename(args.candidate).replace(/^benchmark-results-|\.json$/g, '');

    const baseline = readRecords(args.baseline);
    const candidate = readRecords(args.candidate);

    const { perBucket, overallByTarget, diag } = aggregate(baseline, candidate);
    const report = buildReport(baselineLabel, candidateLabel, perBucket, overallByTarget, diag);

    process.stdout.write(report);
    if (args.out) {
        fs.writeFileSync(args.out, report);
        console.error(`\nWrote ${args.out}`);
    }
}

main();
