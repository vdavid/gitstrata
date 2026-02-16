interface FeaturedRepo {
    owner: string
    repo: string
}

/** Universally recognized repos — at least 1 always appears in a set */
const headliners: FeaturedRepo[] = [
    { owner: 'vuejs', repo: 'core' },
    { owner: 'django', repo: 'django' },
    { owner: 'rails', repo: 'rails' },
    { owner: 'sveltejs', repo: 'svelte' },
    { owner: 'tailwindlabs', repo: 'tailwindcss' },
    { owner: 'vitejs', repo: 'vite' },
    { owner: 'denoland', repo: 'deno' },
    { owner: 'expressjs', repo: 'express' },
    { owner: 'elixir-lang', repo: 'elixir' },
    { owner: 'laravel', repo: 'laravel' },
    { owner: 'prettier', repo: 'prettier' },
]

/** Modern/interesting repos across categories */
const others: FeaturedRepo[] = [
    // Frontend
    { owner: 'remix-run', repo: 'remix' },
    { owner: 'solidjs', repo: 'solid' },
    { owner: 'withastro', repo: 'astro' },
    { owner: 'preactjs', repo: 'preact' },
    { owner: 'reduxjs', repo: 'redux' },
    { owner: 'shadcn-ui', repo: 'ui' },
    { owner: 'mermaid-js', repo: 'mermaid' },

    // Backend
    { owner: 'fastify', repo: 'fastify' },
    { owner: 'pallets', repo: 'flask' },
    { owner: 'spring-projects', repo: 'spring-boot' },
    { owner: 'gin-gonic', repo: 'gin' },
    { owner: 'actix', repo: 'actix-web' },
    { owner: 'honojs', repo: 'hono' },
    { owner: 'koajs', repo: 'koa' },
    { owner: 'tiangolo', repo: 'fastapi' },

    // AI/ML
    { owner: 'ollama', repo: 'ollama' },
    { owner: 'ggml-org', repo: 'llama.cpp' },
    { owner: 'openai', repo: 'whisper' },
    { owner: 'AUTOMATIC1111', repo: 'stable-diffusion-webui' },
    { owner: 'mlc-ai', repo: 'web-llm' },
    { owner: 'xenova', repo: 'transformers.js' },

    // Devtools
    { owner: 'eslint', repo: 'eslint' },
    { owner: 'biomejs', repo: 'biome' },
    { owner: 'evanw', repo: 'esbuild' },
    { owner: 'prometheus', repo: 'prometheus' },
    { owner: 'vitest-dev', repo: 'vitest' },
    { owner: 'rollup', repo: 'rollup' },
    { owner: 'jqlang', repo: 'jq' },

    // Infra and tools
    { owner: 'docker', repo: 'compose' },
    { owner: 'prisma', repo: 'prisma' },
    { owner: 'trpc', repo: 'trpc' },
    { owner: 'drizzle-team', repo: 'drizzle-orm' },
]

const fullPool = [...headliners, ...others]

/**
 * Pick `count` featured repos with at least 1 headliner. Uses Fisher-Yates partial shuffle
 * for efficient random selection without duplicates.
 */
export const pickFeaturedRepos = (count = 3): FeaturedRepo[] => {
    const headliner = headliners[Math.floor(Math.random() * headliners.length)]

    // Fisher-Yates partial shuffle on the rest of the pool (excluding the chosen headliner)
    const pool = fullPool.filter((r) => r.owner !== headliner.owner || r.repo !== headliner.repo)
    const needed = count - 1
    for (let i = pool.length - 1; i > pool.length - 1 - needed && i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }

    const result = [headliner, ...pool.slice(pool.length - needed)]

    // Shuffle the final result so the headliner isn't always first
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[result[i], result[j]] = [result[j], result[i]]
    }

    return result
}

const placeholderTemplates = [
    (r: FeaturedRepo) => `Example: https://github.com/${r.owner}/${r.repo}`,
    () => 'Example: https://gitlab.com/gitlab-org/gitlab',
    () => 'Example: https://bitbucket.org/atlassian/aui',
]

/** Pick a random placeholder string, roughly equal chance of GitHub/GitLab/Bitbucket */
export const pickPlaceholder = (repos: FeaturedRepo[]): string => {
    const template = placeholderTemplates[Math.floor(Math.random() * placeholderTemplates.length)]
    const repo = repos[Math.floor(Math.random() * repos.length)]
    return template(repo)
}
