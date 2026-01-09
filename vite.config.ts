/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { builtinModules } from 'node:module';

export default defineConfig({
    build: {
        target: 'node24',
        lib: {
            entry: {
                vrp: resolve(__dirname, 'src/index.ts'),
                'p-sa.worker': resolve(__dirname, 'src/algorithms/p-sa/p-sa.worker.ts'),
                tunePsa: resolve(__dirname, 'src/tune-psa.ts'),
            },
            name: 'VRP',
            formats: ['es'],
            fileName: (format, entryName) => `${entryName}.${format}.mjs`,
        },
        rollupOptions: {
            external: [...builtinModules, ...builtinModules.map(m => `node:${m}`), 'rust-solver'],
        },
        sourcemap: true,
        emptyOutDir: true,
    },
    plugins: [
        dts({
            insertTypesEntry: true,
            outDir: 'dist',
        }),
        viteStaticCopy({
            targets: [
                {
                    src: 'problems',
                    dest: '.',
                },
            ],
        }),
    ],
    define: {
        'import.meta.vitest': 'undefined',
    },
});
