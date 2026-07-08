# Pages Functions

Cloudflare Pages Functions that run alongside the static frontend on the same origin (gitstrata.com). Wrangler discovers
this `functions/` directory at deploy time (`wrangler pages deploy build/`, run from the repo root) and compiles it into
a Worker that fronts the static assets. Routes not matched by a function fall through to the static site.

## Analytics proxy (`u/[[path]].ts`)

Same-origin proxy for the Umami analytics tracker, matching `/u/*`.

- **Why it exists**: Loading the tracker directly from a third-party analytics domain at the well-known `/script.js`
  path gets it blocked by adblockers on both counts, so most visitors go uncounted. Serving it first-party under `/u/*`
  sidesteps the blocklists.
- **Path mapping**: `/u/mami` → upstream `/script.js` (the only path Umami serves the tracker at). Everything else maps
  straight through, notably the beacon: the tracker derives its collect endpoint from its own script directory, so with
  `src="/u/mami"` it posts to `/u/api/send`, which proxies to upstream `/api/send`. The `data-website-id` on the script
  tag (`src/routes/+layout.svelte`) is what ties events to the right site.
- **Upstream host**: defaults to git strata's own Umami instance. Self-hosters override it with the `ANALYTICS_UPSTREAM`
  environment variable on the Pages project (Cloudflare dashboard > Settings > Environment variables, or a Pages
  `wrangler.toml` `[vars]`).
- **Caching**: the tracker script gets `Cache-Control: public, max-age=3600`; the beacon (and any other path) gets
  `no-store`.
- **Client IP**: the real visitor IP (`cf-connecting-ip`) is forwarded as `x-forwarded-for` so Umami counts uniques
  correctly instead of attributing every hit to the proxy.
