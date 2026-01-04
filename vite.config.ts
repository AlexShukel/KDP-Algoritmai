/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
    build: {
        target: 'node24',
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'VRP',
            formats: ['es', 'cjs'],
            fileName: format => `vrp.${format}.js`,
        },
        rollupOptions: {
            external: ['fs', 'fs/promises', 'path', 'glob', 'perf_hooks', 'rust-solver'],
            output: {
                manualChunks: undefined,
            },
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
