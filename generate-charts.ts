import fs from 'fs';
import path from 'path';
import { OptimizationTarget, BenchmarkRecord } from './src/types';

const TARGET_TO_PLOT = OptimizationTarget.DISTANCE;

interface ComplexityGroup {
    size: number;
    bfTimes: number[];
    algoTimes: number[];
    rpds: number[];
}

function getLegendName(filePath: string): string {
    const lower = filePath.toLowerCase();
    if (lower.includes('brute-force')) {
        return 'Brute force';
    }
    if (lower.includes('p-sa')) {
        return 'PSA (Parallel Simulated Annealing)';
    }
    return path.parse(filePath).name;
}

function average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        console.error('Usage: npx ts-node generate-charts-lt.ts <brute-force.json> <heuristic.json>');
        process.exit(1);
    }

    const [bfPath, heurPath] = args;
    const bfName = getLegendName(bfPath);
    const heurName = getLegendName(heurPath);

    console.log(`Processing data: ${bfName} vs ${heurName}...`);

    const bfRecords: BenchmarkRecord[] = JSON.parse(fs.readFileSync(bfPath, 'utf-8'));
    const heurRecords: BenchmarkRecord[] = JSON.parse(fs.readFileSync(heurPath, 'utf-8'));

    const groups = new Map<number, ComplexityGroup>();

    const getGroup = (size: number) => {
        if (!groups.has(size)) {
            groups.set(size, { size, bfTimes: [], algoTimes: [], rpds: [] });
        }
        return groups.get(size)!;
    };

    const optimalValues = new Map<string, number>();

    bfRecords.forEach(r => {
        if (r.optimizationTarget !== TARGET_TO_PLOT) return;
        const size = r.problemSize.orders + r.problemSize.vehicles;
        optimalValues.set(r.problemPath, r.metrics.totalDistance);
        getGroup(size).bfTimes.push(r.execTime);
    });

    heurRecords.forEach(r => {
        if (r.optimizationTarget !== TARGET_TO_PLOT) return;
        const size = r.problemSize.orders + r.problemSize.vehicles;
        getGroup(size).algoTimes.push(r.execTime);

        const opt = optimalValues.get(r.problemPath);
        if (opt !== undefined && opt > 0) {
            const rpd = ((r.metrics.totalDistance - opt) / opt) * 100;
            getGroup(size).rpds.push(Math.max(0, rpd));
        }
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) => a.size - b.size);

    const dataTimeBF = sortedGroups
        .filter(g => g.bfTimes.length > 0)
        .map(g => `(${g.size}, ${average(g.bfTimes).toFixed(2)})`)
        .join(' ');

    const dataTimeAlgo = sortedGroups
        .filter(g => g.algoTimes.length > 0)
        .map(g => `(${g.size}, ${average(g.algoTimes).toFixed(2)})`)
        .join(' ');

    const dataRPD = sortedGroups
        .filter(g => g.rpds.length > 0)
        .map(g => `(${g.size}, ${average(g.rpds).toFixed(3)})`)
        .join(' ');

    const allRpds = sortedGroups.flatMap(g => g.rpds);
    const buckets = {
        'Optimalus (0\\%)': 0,
        '$<$1\\%': 0,
        '$<$5\\%': 0,
        '$>$5\\%': 0,
    };

    allRpds.forEach(rpd => {
        if (rpd < 0.001) buckets['Optimalus (0\\%)']++;
        else if (rpd < 1.0) buckets['$<$1\\%']++;
        else if (rpd < 5.0) buckets['$<$5\\%']++;
        else buckets['$>$5\\%']++;
    });

    const totalRuns = allRpds.length || 1;
    const dataReliability = Object.entries(buckets)
        .map(([label, count]) => `(${label}, ${(count / totalRuns) * 100})`)
        .join(' ');

    const texScalability = `
% Diagrama: Vykdymo laikas (Scalability)
\\begin{figure}[hbt!]
\\centering
\\begin{tikzpicture}
    \\begin{axis}[
        xlabel={Uždavinio sudėtingumas (Užsakymų ir vilkikų kiekis)},
        ylabel={Vidutinis vykdymo laikas (ms)},
        ymode=log,
        log basis y={10},
        grid=major,
        width=0.95\\linewidth,
        height=7cm,
        legend pos=north west,
        xtick={${sortedGroups.map(g => g.size).join(',')}},
        mark size=2.5pt,
        legend style={nodes={scale=0.8, transform shape}} 
    ]
    
    \\addplot[color=red!80!black, mark=square*, thick] coordinates { ${dataTimeBF} };
    \\addlegendentry{${bfName}}

    \\addplot[color=blue!80!black, mark=*, thick] coordinates { ${dataTimeAlgo} };
    \\addlegendentry{${heurName}}
    
    \\end{axis}
\\end{tikzpicture}
\\caption{Algoritmų vykdymo laiko palyginimas (logaritminė skalė).}
\\label{fig:vykdymo_laikas}
\\end{figure}
`;
    fs.writeFileSync(path.join(__dirname, 'diagram_scalability.tex'), texScalability);

    const texQuality = `
% Diagrama: Kokybės degradacija (RPD)
\\begin{figure}[hbt!]
\\centering
\\begin{tikzpicture}
    \\begin{axis}[
        xlabel={Uždavinio sudėtingumas (Užsakymų ir vilkikų kiekis)},
        ylabel={Vidutinis nuokrypis (RPD \\%)},
        grid=major,
        width=0.95\\linewidth,
        height=6cm,
        ymin=0,
        xtick={${sortedGroups.map(g => g.size).join(',')}},
        mark options={solid},
        style={thick},
        legend pos=north west
    ]
    
    \\addplot[color=orange!90!black, mark=triangle*, dashed] coordinates { ${dataRPD} };
    \\addlegendentry{Vidutinis nuokrypis}
    
    \\end{axis}
\\end{tikzpicture}
\\caption{Sprendinių kokybės priklausomybė nuo uždavinio dydžio.}
\\label{fig:rpd_kokybe}
\\end{figure}
`;
    fs.writeFileSync(path.join(__dirname, 'diagram_quality.tex'), texQuality);

    const texReliability = `
% Diagrama: Patikimumo histograma
\\begin{figure}[hbt!]
\\centering
\\begin{tikzpicture}
    \\begin{axis}[
        ybar,
        symbolic x coords={Optimalus (0\\%),$<$1\\%,$<$5\\%,$>$5\\%},
        xtick=data,
        ylabel={Vykdymų dalis (\\%)},
        xlabel={Nuokrypio rėžiai},
        ymin=0, ymax=115, % Šiek tiek daugiau nei 100, kad tilptų skaičiai
        nodes near coords={\\pgfmathprintnumber\\pgfplotspointmeta\\%},
        width=0.95\\linewidth,
        height=7cm,
        bar width=1.2cm,
        grid=y major,
        enlarge x limits=0.15
    ]
    
    \\addplot[fill=blue!30, draw=blue!80!black] coordinates { ${dataReliability} };
    
    \\end{axis}
\\end{tikzpicture}
\\caption{Euristikos sprendinių kokybės pasiskirstymas per visus vykdymus.}
\\label{fig:patikimumas}
\\end{figure}
`;
    fs.writeFileSync(path.join(__dirname, 'diagram_reliability.tex'), texReliability);

    console.log(`\nGenerated files:`);
    console.log(`- diagram_scalability.tex`);
    console.log(`- diagram_quality.tex`);
    console.log(`- diagram_reliability.tex`);
}

main().catch(console.error);
