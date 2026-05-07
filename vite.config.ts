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
                // Two bundle entries remain after the 2026-05-07 TS p-SA
                // removal: the harness (`vrp`) and the parameter tuner
                // (`tunePsa`). The previous `p-sa.worker` entry was the
                // worker-thread script for the now-deleted TS p-SA — its
                // Rust replacement (`vrppd-psa` crate, napi-bridge bound)
                // does its own threading internally and needs no JS
                // worker bundle.
                vrp: resolve(__dirname, 'src/index.ts'),
                tunePsa: resolve(__dirname, 'src/tune-psa.ts'),
            },
            name: 'VRP',
            formats: ['es'],
            fileName: (format, entryName) => `${entryName}.${format}.mjs`,
        },
        rollupOptions: {
            external: [...builtinModules, ...builtinModules.map(m => `node:${m}`), 'napi-bridge'],
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
