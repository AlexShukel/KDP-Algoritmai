import fs from 'fs/promises';
import path from 'path';
import { BruteForceAlgorithm } from './src/algorithms/brute-force';
import { problemJsonSchema } from './src/types/types';
import { greatCircleDistanceCalculator } from './src/utils/greatCircleDistanceCalculator';

const problemsDir = path.resolve(__dirname, 'problems');

const main = async () => {
    const problemDirs = await fs.readdir(problemsDir);

    for (const dir of problemDirs) {
        // get number of vehicles and number of orders from dir name
        const [vehQty, ordQty] = dir.split('_').map(val => Number.parseInt(val));

        if (vehQty !== 5 || ordQty !== 5) {
            continue;
        }

        const problemsClassDir = path.resolve(problemsDir, dir);
        const problemFiles = (await fs.readdir(problemsClassDir)).filter(file => {
            const { ext, name } = path.parse(file);
            return ext === '.json' && !name.endsWith('_solved');
        });

        let totalExecTime = 0;
        for (const file of problemFiles) {
            const rawProblem = (await fs.readFile(path.resolve(problemsClassDir, file))).toString();
            const problem = problemJsonSchema.parse(JSON.parse(rawProblem));

            console.log('Solving problem of size ' + dir);

            const start = process.hrtime.bigint();
            const output = new BruteForceAlgorithm().solve(problem, { distanceCalc: greatCircleDistanceCalculator });
            const end = process.hrtime.bigint();

            const execTime = Number((end - start) / BigInt(1e6));
            totalExecTime += execTime;

            console.log(
                `Solved problem in ${execTime}ms.\nMin total distance = ${output.bestDistanceSolution.totalDistance}\nMin total empty distance = ${output.bestEmptyDistanceSolution.emptyDistance}\nMin total price = ${output.bestPriceSolution.totalPrice}`,
            );
            console.log();

            const { name } = path.parse(file);

            await fs.writeFile(path.resolve(problemsClassDir, `${name}_solved.json`), JSON.stringify(output, null, 2));
        }

        console.log(`Problem class ${dir} average execution time ${totalExecTime / problemFiles.length}ms`);
        console.log();
    }
};

main().catch(err => {
    console.error(err);
    process.exit(1);
});
