import { fileURLToPath } from 'node:url'
import devtoolsJson from 'vite-plugin-devtools-json'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
    build: { sourcemap: true },
    worker: { format: 'es', rollupOptions: { output: { sourcemap: true } } },
    // Vite 8 (Rolldown) no longer rewrites bare `global` to `globalThis` in worker bundles, breaking UMD polyfills like `fast-text-encoding` (pulled in by `lightning-fs`) that probe `typeof global`.
    define: { global: 'globalThis' },
    // `isomorphic-git`'s `exports."."` only declares a CJS entry that imports Node's `crypto`. Force the ESM entry, which uses a pure-JS SHA-1 instead.
    resolve: {
        alias: [
            {
                find: /^isomorphic-git$/,
                replacement: fileURLToPath(new URL('./node_modules/isomorphic-git/index.js', import.meta.url)),
            },
        ],
    },
    server: {
        port: Number(process.env.CONDUCTOR_PORT) || 5233,
        strictPort: true,
        watch: {
            ignored: ['**/*.md', '**/todo.md', '**/.claude/**'],
        },
    },
    test: { include: ['tests/**/*.test.ts'] },
})
