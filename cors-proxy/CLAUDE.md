# cors-proxy

Minimal Cloudflare Worker (Hono) that adds CORS headers and forwards bytes to git hosts. Caches reference discovery
responses; otherwise just a pass-through proxy.

## Running

- `pnpm dev` — local dev server via wrangler
- `pnpm deploy` — deploy to Cloudflare Workers

## Key decisions

- Only allows git protocol paths (`/info/refs`, `/git-upload-pack`) — rejects everything else with 403.
- Rate limiting: 100 req/min per IP using in-memory counters (resets each minute). Since Workers are ephemeral, this is
  best-effort. For stricter limits, use Cloudflare's built-in rate limiting product.
- The target URL is extracted from the request path: `https://proxy-host/https://github.com/foo/bar.git/info/refs`.
- **Caching**: GET `/info/refs` responses are cached via the Cloudflare Cache API with a 12-hour TTL
  (`Cache-Control: public, max-age=43200`). The cache key is the full target git host URL. POST `/git-upload-pack`
  requests are never cached. The `X-Cache` response header indicates `HIT`, `MISS`, or `NONE` (for uncacheable
  requests). Cache is per-datacenter, not global.
- For local frontend development, use `https://cors.isomorphic-git.org` instead — no need to run this worker locally.
- **Shared results cache (optional)**: When an R2 bucket binding (`RESULTS`) is present, two cache routes
  activate. Without the binding, they return 404 and the proxy behaves as before.
  - `GET /cache/v1/:repoHash` — returns gzip-compressed JSON from R2, 5-min edge cache.
  - `PUT /cache/v1/:repoHash` — accepts gzip-compressed `SharedCacheEntry` JSON. Validates shape,
    10 MB size limit, repo URL hash match, and write rate limit (10/min per IP).
  - R2 object key: `results/v1/{sha256(repoUrl)}.json.gz`.
  - The R2 binding is commented out in `wrangler.toml` by default — uncomment to enable.
