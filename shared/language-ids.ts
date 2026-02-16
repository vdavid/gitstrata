/**
 * Single source of truth for valid language IDs.
 * Importable from both the SvelteKit frontend and the Cloudflare Worker.
 *
 * Keep in sync with `src/lib/languages.ts` — the drift-detection test
 * in `tests/language-ids-sync.test.ts` will catch mismatches.
 */

export const validLanguageIds: ReadonlySet<string> = new Set([
    // Programming languages
    'python',
    'javascript',
    'typescript',
    'rust',
    'go',
    'c',
    'cpp',
    'csharp',
    'java',
    'kotlin',
    'swift',
    'objc',
    'zig',
    'ruby',
    'php',
    'scala',
    'dart',
    'elixir',
    'haskell',
    'lua',
    'perl',
    'r',
    'julia',
    'clojure',
    'erlang',
    'ocaml',
    'fsharp',
    'shell',
    'powershell',

    // Markup / style / query
    'html',
    'css',
    'sql',

    // Frameworks
    'svelte',
    'vue',
    'astro',

    // Meta
    'docs',
    'config',

    // Catch-all for unrecognized extensions (from src/lib/git/count.ts)
    'other',
])

export const isValidLanguageId = (id: string): boolean => validLanguageIds.has(id)
