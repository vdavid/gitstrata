# cors-proxy

Minimal Cloudflare Worker (Hono) that adds CORS headers and forwards bytes to git hosts. Caches reference discovery
responses; otherwise just a pass-through proxy.

## Running

- `pnpm dev` — local dev server via wrangler
- `pnpm deploy` — deploy to Cloudflare Workers

## Key decisions

- **CORS origin**: `ALLOWED_ORIGIN` in `wrangler.toml` restricts `Access-Control-Allow-Origin` to the
  production frontend. Override in `.dev.vars` for local dev. When unset, falls back to `*`.
- **Host allowlist**: Only proxies to `github.com`, `gitlab.com`, and `bitbucket.org`. Rejects all other hosts.
- Only allows git protocol paths (`/info/refs`, `/git-upload-pack`) — validated against `pathname`, not the full URL.
- **Header allowlist**: Only forwards `content-type`, `content-length`, `accept`, `accept-encoding`, and `git-protocol`
  to upstream. All other incoming headers (including `Authorization`, `Cookie`) are stripped.
- **Rate limiting**: Two layers. Cloudflare Rate Limiting (configured in the Cloudflare dashboard, not in code) enforces
  hard per-IP limits at the edge. In-memory counters (100 req/min, 10 writes/min) act as a best-effort secondary check
  within each Worker isolate. The in-memory layer is not durable (resets on cold start, per-isolate), so the Cloudflare
  product is the primary defense.
- The target URL is extracted from the request path. isomorphic-git strips the protocol (`https://`) when
  using `corsProxy`, so the proxy re-adds `https://` when the path doesn't start with `http`.
  Example: `https://proxy-host/github.com/foo/bar.git/info/refs` → upstream `https://github.com/foo/bar.git/info/refs`.
- **Caching**: GET `/info/refs` v1 responses (no `Git-Protocol` header) are cached via the Cloudflare Cache API
  with a 12-hour TTL (`Cache-Control: public, max-age=43200`). v2 responses are never cached — isomorphic-git
  uses v2 for branch detection then v1 for clone, and caching v2 would poison v1 lookups. `/info/refs` responses
  to the browser include `Cache-Control: no-store` so the browser doesn't cache them either (same v1/v2 concern).
  POST `/git-upload-pack` requests are never cached. The `X-Cache` response header indicates `HIT`, `MISS`, or
  `NONE` (for uncacheable requests). Cache is per-datacenter, not global.
- For local frontend development, use `https://cors.isomorphic-git.org` instead — no need to run this worker locally.
- **Shared results cache (optional)**: When an R2 bucket binding (`RESULTS`) is present, two cache routes
  activate. Without the binding, they return 404 and the proxy behaves as before.
  - `GET /cache/v1/:repoHash` — returns gzip-compressed JSON from R2, 5-min edge cache.
  - `PUT /cache/v1/:repoHash` — accepts gzip-compressed `SharedCacheEntry` JSON. Requires `Authorization: Bearer`
    token matching the `CACHE_WRITE_TOKEN` secret (set via `wrangler secret put`). In production (when `ALLOWED_ORIGIN`
    is set), cache writes are rejected with 403 if the token is not configured — fail-closed. In dev (no
    `ALLOWED_ORIGIN`), writes are open. Validates shape, 10 MB size limit, repo URL hash match, and write rate limit
    (10/min per IP).
  - R2 object key: `results/v1/{sha256(repoUrl)}.json.gz`.
  - The R2 binding is commented out in `wrangler.toml` by default — uncomment to enable.
