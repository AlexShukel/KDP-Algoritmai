import fs from 'fs/promises';

const problemsDir = 'problems';

async function main(): Promise<void> {
    const problemDirs = await fs.readdir(problemsDir);
    console.log(problemDirs);
}

main().catch(error => {
    console.error('\nBenchmark suite failed:', error.message);

    if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
    }

    process.exit(1);
});
