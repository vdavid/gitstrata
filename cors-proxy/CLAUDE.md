# cors-proxy

Minimal Cloudflare Worker (Hono) that adds CORS headers and forwards bytes to git hosts. Caches reference discovery
responses; otherwise just a pass-through proxy.

## Running

- `pnpm dev` — local dev server via wrangler
- `pnpm deploy` — deploy to Cloudflare Workers

## Key decisions

- **CORS origin**: `ALLOWED_ORIGIN` in `wrangler.toml` restricts `Access-Control-Allow-Origin` to the production
  frontend. Override in `.dev.vars` for local dev. When unset, falls back to `*`.
- **Host allowlist**: Only proxies to `github.com`, `gitlab.com`, and `bitbucket.org`. Rejects all other hosts.
- Only allows git protocol paths (`/info/refs`, `/git-upload-pack`) — validated against `pathname`, not the full URL.
- **Header allowlist**: Only forwards `content-type`, `content-length`, `accept`, `accept-encoding`, and `git-protocol`
  to upstream. All other incoming headers (including `Authorization`, `Cookie`) are stripped.
- **Rate limiting**: Two layers. Cloudflare Rate Limiting (configured in the Cloudflare dashboard, not in code) enforces
  hard per-IP limits at the edge. In-memory counters (100 req/min, 10 writes/min) act as a best-effort secondary check
  within each Worker isolate. The in-memory layer is not durable (resets on cold start, per-isolate), so the Cloudflare
  product is the primary defense.
- The target URL is extracted from the request path. isomorphic-git strips the protocol (`https://`) when using
  `corsProxy`, so the proxy re-adds `https://` when the path doesn't start with `http`. Example:
  `https://proxy-host/github.com/foo/bar.git/info/refs` → upstream `https://github.com/foo/bar.git/info/refs`.
- **Caching**: GET `/info/refs` v1 responses (no `Git-Protocol` header) are cached via the Cloudflare Cache API with a
  12-hour TTL (`Cache-Control: public, max-age=43200`). v2 responses are never cached — isomorphic-git uses v2 for
  branch detection then v1 for clone, and caching v2 would poison v1 lookups. `/info/refs` responses to the browser
  include `Cache-Control: no-store` so the browser doesn't cache them either (same v1/v2 concern). POST
  `/git-upload-pack` requests are never cached. The `X-Cache` response header indicates `HIT`, `MISS`, or `NONE` (for
  uncacheable requests). Cache is per-datacenter, not global.
- **No upstream fetch timeout**: The proxy does not set a timeout on the `fetch()` to git hosts. This is intentional.
  Cloudflare Workers have no hard wall-clock duration limit — a Worker runs as long as the client stays connected. CPU
  time limits (Free: 10 ms, Paid: 5 min) only count active computation; I/O wait (streaming bytes) does not count. The
  proxy does near-zero CPU work, so even the free plan is fine. Large repos like `torvalds/linux` can take 30+ minutes
  for GitHub's server-side pack preparation ("Counting objects"), during which the proxy just streams sideband progress
  bytes. Timeout/staleness logic lives client-side (`StalenessMonitor` in `clone.ts`). Source:
  https://developers.cloudflare.com/workers/platform/limits/
- For local frontend development, use `https://cors.isomorphic-git.org` instead — no need to run this worker locally.
- **Shared results cache (optional)**: When an R2 bucket binding (`RESULTS`) is present, two cache routes activate.
  Without the binding, they return 404 and the proxy behaves as before.
    - `GET /cache/v1/:repoHash` — returns gzip-compressed JSON from R2, 5-min edge cache.
    - `PUT /cache/v1/:repoHash` — accepts gzip-compressed `SharedCacheEntry` JSON. Requires `Authorization: Bearer`
      token matching the `CACHE_WRITE_TOKEN` secret (set via `wrangler secret put`). In production (when
      `ALLOWED_ORIGIN` is set), cache writes are rejected with 403 if the token is not configured — fail-closed. In dev
      (no `ALLOWED_ORIGIN`), writes are open. Full PUT validation pipeline:
        1. Auth check (Bearer token)
        2. Rate limit (100 req/min general, 10 writes/min)
        3. Size guard + gzip decompress + JSON parse (10 MB compressed, 50 MB decompressed)
        4. `validateCacheEntry` (`validate-cache-entry.ts`) — shape, repoUrl format, headCommit hex, day caps, date
           format, number invariants, language ID allowlist, comment types
        5. Repo hash check (SHA-256 of repoUrl must match `:repoHash`)
        6. `verifyHeadCommit` (`verify-head-commit.ts`) — fetches `/info/refs?service=git-upload-pack` from the real git
           host and confirms the submitted headCommit OID exists in the response (5 s timeout, fail-closed)
        7. R2 put
    - R2 object key: `results/v1/{sha256(repoUrl)}.json.gz`.
    - The R2 binding is commented out in `wrangler.toml` by default — uncomment to enable.
- **Shared language IDs** (`shared/language-ids.ts`): Single source of truth for all valid language IDs, imported by
  both the Cloudflare Worker (for cache entry validation) and the frontend. A drift-detection test
  (`tests/language-ids-sync.test.ts`) ensures `validLanguageIds` stays in sync with `src/lib/languages.ts`.
