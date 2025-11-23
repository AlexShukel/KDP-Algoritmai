async function main(): Promise<void> {}

main().catch(error => {
    console.error('\nBenchmark suite failed:', error.message);

    if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
    }

    process.exit(1);
});
