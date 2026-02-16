import type { KnipConfig } from 'knip'

const config: KnipConfig = {
    entry: ['src/routes/**/+*.{ts,svelte}', 'src/lib/worker/analyzer.worker.ts'],
    project: ['src/**/*.{ts,svelte}'],
    ignore: ['src/app.d.ts'],
    ignoreBinaries: ['wrangler'],
    ignoreDependencies: ['@vitest/coverage-v8', 'buffer', 'tailwindcss'],
}

export default config
