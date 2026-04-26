import devtoolsJson from 'vite-plugin-devtools-json'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
    // Vite 8 (Rolldown) no longer rewrites bare `global` to `globalThis` in worker bundles, breaking UMD polyfills like `fast-text-encoding` (pulled in by `lightning-fs`) that probe `typeof global`.
    define: { global: 'globalThis' },
    server: {
        port: Number(process.env.CONDUCTOR_PORT) || 5233,
        strictPort: true,
        watch: {
            ignored: ['**/*.md', '**/todo.md', '**/.claude/**'],
        },
    },
    test: { include: ['tests/**/*.test.ts'] },
})
