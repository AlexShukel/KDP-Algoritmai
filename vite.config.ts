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
            external: ['fs', 'fs/promises', 'path'],
            output: {
                manualChunks: undefined,
            },
        },
        sourcemap: true,
        emptyOutDir: true,
        assetsDir: 'problems',
    },
    plugins: [
        dts({
            insertTypesEntry: true,
            outDir: 'dist',
        }),
        // viteStaticCopy({
        //     targets: [
        //         {
        //             src: 'src/problems/**/*',
        //             dest: 'problems',
        //         },
        //     ],
        // }),
    ],
    define: {
        'import.meta.vitest': 'undefined',
    },
});
