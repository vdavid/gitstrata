# cors-proxy

Minimal Cloudflare Worker (Hono) that adds CORS headers and forwards bytes to git hosts. Caches reference discovery
responses; otherwise just a pass-through proxy.

## Running

- `pnpm dev` — local dev server via wrangler
- `pnpm deploy` — deploy to Cloudflare Workers

Run these from this directory. `cors-proxy/` is a standalone pnpm project (own `package.json` + `pnpm-lock.yaml`), not
part of the repo-root workspace. Its own `pnpm-workspace.yaml` marks it as an independent workspace root — without it,
pnpm (11+) walks up to the repo-root `pnpm-workspace.yaml` and installs the frontend workspace instead, leaving
`cors-proxy/node_modules` (and `wrangler`) missing, which breaks `pnpm deploy` and the CI deploy job.

## Key decisions

- **CORS origin allowlist**: `ALLOWED_ORIGINS` under `[vars]` in `wrangler.toml` (a top-level key is silently ignored by
  wrangler, which once left production on `*`). Comma-separated; each entry is an exact origin or `<scheme>://*.<host>`,
  where `*` matches exactly one DNS label (no dots). Production: `https://gitstrata.com,https://*.git-strata.pages.dev`,
  the wildcard covering Cloudflare Pages preview (`<hash>.git-strata.pages.dev`) and branch-alias builds. Logic in
  `allowed-origins.ts`: plain prefix/suffix string checks, no regex built from config.
    - Allowed origin → echoed in `Access-Control-Allow-Origin`, with `Vary: Origin` (the `/cache` GET is edge-cached).
    - Disallowed `Origin` on any non-`OPTIONS` request → 403 with no ACAO, before any upstream fetch or R2 access
      (middleware in `index.ts`). **Why:** browsers only block reading the response, so without the 403 any site could
      still make the proxy do the work. Disallowed preflights get 204 with no ACAO, so the browser stops there.
    - No `Origin` header (curl, server-to-server) → served normally, no ACAO.
    - Unset or empty → any origin (`*`), and 502s include the upstream error message. `wrangler dev` reads `[vars]` too,
      so set `ALLOWED_ORIGINS` in `.dev.vars` to your local frontend origin (or to an empty string) when testing the
      worker locally.
- **Host allowlist**: Only proxies to `github.com`, `gitlab.com`, and `bitbucket.org`. Rejects all other hosts.
- Only allows git protocol paths (`/info/refs`, `/git-upload-pack`) — validated against `pathname`, not the full URL.
- **Header allowlist**: Only forwards `content-type`, `content-length`, `accept`, `accept-encoding`, `git-protocol`, and
  `authorization` to upstream. All other incoming headers (including `Cookie`) are stripped. `authorization` is
  forwarded so private repos can authenticate with a GitHub token; it only ever reaches the allowlisted git hosts. The
  `WWW-Authenticate` response header is passed back through so isomorphic-git's 401→`onAuth` retry works.
- **Never cache authed responses**: the `/info/refs` cache is keyed by URL only, so caching a private repo's refs would
  leak them to the next requester of the same URL. `shouldCache` is gated on the absence of an `Authorization` header.
- **Rate limiting**: Two layers. Cloudflare Rate Limiting (configured in the Cloudflare dashboard, not in code) enforces
  hard per-IP limits at the edge. In-memory counters (100 req/min, 10 writes/min) act as a best-effort secondary check
  within each Worker isolate. The in-memory layer is not durable (resets on cold start, per-isolate), so the Cloudflare
  product is the primary defense.
- The target URL is extracted from the request path. isomorphic-git strips the protocol (`https://`) when using
  `corsProxy`, so the proxy re-adds `https://` when the path doesn't start with `http`. Example:
  `https://proxy-host/github.com/foo/bar.git/info/refs` → upstream `https://github.com/foo/bar.git/info/refs`.
- **Caching**: GET `/info/refs` v1 responses (no `Git-Protocol` header) are cached via the Cloudflare Cache API with a
  5-minute TTL (`Cache-Control: public, max-age=300`). v2 responses are never cached — isomorphic-git uses v2 for branch
  detection then v1 for clone, and caching v2 would poison v1 lookups. `/info/refs` responses to the browser include
  `Cache-Control: no-store` so the browser doesn't cache them either (same v1/v2 concern). POST `/git-upload-pack`
  requests are never cached. The `X-Cache` response header indicates `HIT`, `MISS`, or `NONE` (for uncacheable
  requests). Cache is per-datacenter, not global.
- **No upstream fetch timeout**: The proxy does not set a timeout on the `fetch()` to git hosts. This is intentional.
  Cloudflare Workers have no hard wall-clock duration limit — a Worker runs as long as the client stays connected. CPU
  time limits (Free: 10 ms, Paid: 5 min) only count active computation; I/O wait (streaming bytes) does not count. The
  proxy does near-zero CPU work, so even the free plan is fine. Large repos like `torvalds/linux` can take 30+ minutes
  for GitHub's server-side pack preparation ("Counting objects"), during which the proxy just streams sideband progress
  bytes. Timeout/staleness logic lives client-side (`StalenessMonitor` in `clone.ts`). Source:
  https://developers.cloudflare.com/workers/platform/limits/
- For local frontend development, use `https://cors.isomorphic-git.org` instead — no need to run this worker locally.
- **Shared results cache**: Active when the R2 binding `RESULTS` is present (it's on in `wrangler.toml`, bucket
  `git-strata-results`). Without the binding, both routes return 404.
    - `GET /cache/v1/:repoHash` — anyone can read. Returns the stored gzip JSON with `Content-Encoding: gzip`, 5-min
      edge cache.
    - `PUT /cache/v1/:repoHash` — only "trusted devices" write: the owner's devices and a few friends, each holding a
      personal write key (`Authorization: Bearer <key>`). The Worker secret `WRITE_KEY_HASHES` holds comma-separated
      lowercase SHA-256 hex digests of the valid keys; the presented key is hashed with `crypto.subtle` and compared in
      constant time against every hash. Missing secret, missing key, or unknown key → 403, in dev too (fail closed; put
      a hash in `.dev.vars` to test writes locally). Anonymous visitors never upload.
    - **Decision/Why — no body parsing**: the Worker is on the free plan (10 ms CPU per request, and it stays there).
      Gunzip + `JSON.parse` + shape validation of a multi-MB result can't fit, so the PUT stores the gzip body as-is and
      trusts the key holder for the content. The client declares what it uploads in headers: `X-Repo-Url` and
      `X-Head-Commit`.
    - PUT pipeline (`cache-write-checks.ts` holds the small pure checks): rate limit (100 req/min, 10 writes/min) → key
      check → `X-Repo-Url` format (`https://(github.com|gitlab.com|bitbucket.org)/<owner>/<repo>`) and `X-Head-Commit`
      (40 lowercase hex) → `sha256(X-Repo-Url)` must equal `:repoHash` → `Content-Length` required (411) and ≤ 10 MB
      (413) → `verifyHeadCommit` (`verify-head-commit.ts`: fetches the host's `/info/refs` and checks the OID is
      advertised; I/O, not CPU; 5 s timeout, fail-closed) → body read with a 10 MB stream cap (`Content-Length` can lie)
      → R2 put.
    - R2 object: `results/v1/{sha256(repoUrl)}.json.gz`, `httpMetadata` (`application/json`, gzip), `customMetadata`
      (`repoUrl`, `headCommit`, `updatedAt`).
    - CORS: the preflight allows `PUT` and the headers `Authorization`, `X-Repo-Url`, `X-Head-Commit`,
      `Content-Encoding`, `Content-Type`. A PUT from a disallowed origin gets 403 before the key check (see the origin
      allowlist above); the write key stays the real access control, since non-browser clients send no `Origin`.
