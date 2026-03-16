# Architecture

High-level map of loc-counter's subsystems. Each row links to the colocated
CLAUDE.md that contains the full details.

## Frontend (`src/lib/`)

Details: [`src/lib/CLAUDE.md`](../src/lib/CLAUDE.md)

| Module | Purpose |
|---|---|
| `components/` | Svelte UI — `ResultsChart`, `ResultsTable`, `ResultsSummary`, `PipelineProgress`, `RepoInput`, era-markers plugin |
| `git/clone.ts` | Clone/fetch via isomorphic-git + lightning-fs, abort support, staleness monitor |
| `git/history.ts` | Commit log grouped by date, batch fetching, `CompactOidSet` dedup |
| `git/count.ts` | Line counting per tree, prod/test classification, blob dedup, incremental tree diffing |
| `git/mailmap.ts` | `.mailmap` parsing and author normalization |
| `worker/` | Web Worker entry point (Comlink) — orchestrates full and incremental analysis pipelines |
| `types.ts` | Shared interfaces (`LanguageCount`, `DayStats`, `AnalysisResult`, `ProgressEvent`, etc.) |
| `languages.ts` | Language registry (~35 languages), extension mapping, inline test detection |
| `cache.ts` | IndexedDB results cache — LRU eviction, 500 MB limit, separate meta store |
| `server-cache.ts` | Shared server cache client (opt-in via `PUBLIC_SHARED_CACHE_URL`) |
| `url.ts` | Repo URL parsing and normalization (GitHub/GitLab/Bitbucket, owner/repo shorthand) |

The SvelteKit app itself lives in `src/routes/` (single page) with global styles
in `src/app.css` (Tailwind v4 + CSS custom properties).

## CORS proxy (`cors-proxy/`)

Details: [`cors-proxy/CLAUDE.md`](../cors-proxy/CLAUDE.md)

| Component | Purpose |
|---|---|
| Cloudflare Worker (Hono) | Adds CORS headers, forwards bytes to git hosts (GitHub, GitLab, Bitbucket) |
| Rate limiting | Cloudflare edge rules + in-memory per-isolate counters |
| Ref caching | Caches v1 `/info/refs` responses at the edge (12 h TTL) |
| Shared results cache | Optional R2-backed cache for analysis results (`GET`/`PUT /cache/v1/:repoHash`) |

## Tooling

| Directory | Purpose |
|---|---|
| `scripts/` | Go-based check runner |
| `tests/` | Vitest (unit) + Playwright (e2e) |
| `shared/` | `language-ids.ts` — single source of truth for valid language IDs, imported by both frontend and CORS proxy |

## Cross-cutting patterns

- **Web Worker isolation** — All git operations and line counting run in a
  dedicated Web Worker (via Comlink). The main thread only drives the UI.
- **Diff-based incremental processing** — After the first commit's full tree
  walk, every subsequent commit uses recursive tree diffing (`diffTreesDetailed`)
  so only changed files are re-counted.
- **IndexedDB caching with LRU eviction** — Analysis results are cached
  client-side in IndexedDB with a 500 MB cap. A separate lightweight meta store
  enables eviction and size checks without deserializing full results.
- **Incremental refresh** — `analyzeIncremental` fetches only new commits since
  the last cached result and merges the new days in.
