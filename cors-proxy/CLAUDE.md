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
- **Caching**: GET `/info/refs` responses are cached via the Cloudflare Cache API with a 5-minute TTL
  (`Cache-Control: public, max-age=300`). The cache key is the full target git host URL. POST `/git-upload-pack`
  requests are never cached. The `X-Cache` response header indicates `HIT`, `MISS`, or `NONE` (for uncacheable
  requests). Cache is per-datacenter, not global.
- For local frontend development, use `https://cors.isomorphic-git.org` instead — no need to run this worker locally.
