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

## Custom events

Sent through `trackEvent` in `src/lib/analytics.ts`, a typed wrapper around `window.umami?.track` (no-op when the
tracker is absent, never throws). Names are kebab-case; `repo` is `owner/repo`, prefixed with the host for non-GitHub
forges (`repoLabel`). Never send tokens or keys. Adding an event means adding it to `EventToPropsMap` and this list.

- `analysis-start` { repo, source: `fresh` | `refresh` | `auto-roll-on` }: a clone-and-count run or a roll-on starts.
- `analysis-done` { repo, mode: `full` | `roll-on`, seconds, days, commits, uploaded }: sent once the shared-cache
  upload settles. A roll-on that falls back to a full recompute still reports `roll-on` (the fallback happens inside the
  worker and isn't surfaced).
- `analysis-error` { repo, kind }: `kind` is the `ErrorKind`, `unknown` for unclassified failures. Silent background
  roll-ons report classified errors too, even though the user sees nothing.
- `analysis-cancel` { repo }: the user cancels a run or a roll-on.
- `cache-hit` { repo, source: `local` | `shared` }: a result shows straight from IndexedDB or the shared cache.
- `shared-adopt` { repo }: a refresh adopted a fresher shared result instead of rolling on locally.
- `size-gate` { repo }: the big-repo warning shows before cloning.
- `write-key-adopted` (no props): a `#write-key=` handoff link stored a sharing key on this device.
