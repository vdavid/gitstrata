# git strata

**See your codebase's heartbeat.**

A browser-native lines-of-code counter that visualizes how a public Git repository grows over time,
broken down by language and prod/test. Zero server-side compute — everything runs in the browser.

## Features

- Paste any public repo URL (GitHub, GitLab, Bitbucket) and get a stacked area chart of LoC over time
- ~35 languages detected automatically with prod/test classification
- Live-updating chart while analysis runs — no waiting for the full result
- Incremental refresh — only processes new commits since the last analysis
- IndexedDB cache with LRU eviction (500 MB limit)
- Dark/light theme with color-blind-safe palettes
- Sortable data table with CSV export
- Shareable URLs via `?repo=` query parameter
- Fully client-side — the only server component is a tiny CORS proxy that forwards bytes

## Quick start

```bash
pnpm install
pnpm dev
```

Open [localhost:5173](http://localhost:5173) and paste a repo URL.

## Architecture

```
Browser
├── Main thread (SvelteKit UI + Chart.js)
│   └── Comlink RPC ↔ Web Worker
│       ├── isomorphic-git (clone/fetch)
│       ├── lightning-fs (IndexedDB filesystem)
│       └── Line counting pipeline
└── IndexedDB (clone cache + results cache)

CORS proxy (Cloudflare Worker)
└── Forwards git protocol bytes with CORS headers
```

The worker clones the repo into an in-browser filesystem, walks the commit history day by day,
counts lines per language, classifies prod vs test, and streams results back to the main thread
for live chart rendering. See [spec.md](spec.md) for the full design.

## Tech stack

| Component       | Technology                            |
| --------------- | ------------------------------------- |
| Framework       | SvelteKit + Svelte 5 (static adapter) |
| Styling         | Tailwind CSS v4                       |
| Git in browser  | isomorphic-git + lightning-fs         |
| Charting        | Chart.js + chartjs-plugin-zoom        |
| Web Worker RPC  | Comlink                               |
| CORS proxy      | Cloudflare Worker + Hono              |
| Package manager | pnpm                                  |

## Development

### Running locally

```bash
pnpm install
pnpm dev
```

The dev server uses the public `https://cors.isomorphic-git.org` proxy, so you don't need to
run the CORS proxy locally.

### Testing

```bash
pnpm test              # unit tests (vitest)
pnpm test:coverage     # with coverage
```

There's also a Go-based check runner for CI-style validation:

```bash
./scripts/check.sh     # runs format, lint, type-check, tests, build
```

### Building

```bash
pnpm build             # outputs static site to build/
pnpm preview           # preview the production build
```

### Other commands

```bash
pnpm check             # svelte-check type checking
pnpm lint              # eslint
pnpm format            # prettier
```

## Deploying

See [docs/deploying.md](docs/deploying.md) for step-by-step deployment instructions for both
the frontend (Cloudflare Pages) and the CORS proxy (Cloudflare Workers).

## License

MIT OR Apache-2.0
