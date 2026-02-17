import type { KnipConfig } from 'knip'

const config: KnipConfig = {
    entry: ['src/routes/**/+*.{ts,svelte}', 'src/hooks.ts', 'src/lib/worker/analyzer.worker.ts'],
    project: ['src/**/*.{ts,svelte}'],
    ignore: ['src/app.d.ts'],
    ignoreBinaries: ['wrangler'],
    ignoreDependencies: ['@vitest/coverage-v8', 'buffer', 'tailwindcss'],
}

// noinspection JSUnusedGlobalSymbols
export default config
