# cors-proxy

Minimal Cloudflare Worker (Hono) that adds CORS headers and forwards bytes to git hosts. Zero compute — just a
pass-through proxy.

## Running

- `pnpm dev` — local dev server via wrangler
- `pnpm deploy` — deploy to Cloudflare Workers

## Key decisions

- Only allows git protocol paths (`/info/refs`, `/git-upload-pack`) — rejects everything else with 403.
- Rate limiting: 100 req/min per IP using in-memory counters (resets each minute). Since Workers are ephemeral, this is
  best-effort. For stricter limits, use Cloudflare's built-in rate limiting product.
- The target URL is extracted from the request path: `https://proxy-host/https://github.com/foo/bar.git/info/refs`.
- For local frontend development, use `https://cors.isomorphic-git.org` instead — no need to run this worker locally.
