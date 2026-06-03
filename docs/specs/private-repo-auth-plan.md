# Private repo support via a GitHub token — plan

Let people analyze their own private GitHub repos by storing a personal access token (PAT) locally and passing it
through to the clone. Surface token management in two places: the "private repository" error and a new key icon in the
header.

## Decisions (from David)

- **Privacy copy**: accurate transit wording. The token is stored only on the device (localStorage), never on a server,
  but it _is_ transmitted to GitHub through the CORS proxy to authenticate the clone. Say exactly that, and link to the
  source so people can verify.
- **Public proxy is blocked**: private-repo auth is only offered when the app runs against a self-hosted proxy. On the
  public default (`cors.isomorphic-git.org`) we don't offer the key form — we explain why and link to the self-hosting
  docs. A token must never transit a third-party proxy.
- **Token type**: recommend a fine-grained PAT with `Contents: read-only`, applied to all (or selected) repositories.
  Least privilege that still gives read access across the user's repos.
- **Verify on entry**: call `https://api.github.com/user` directly (CORS-enabled, no proxy) to confirm the token works
  and capture the account login for display. Reject bad tokens before storing.

## Architecture

### Why the proxy must change first

`cors-proxy/src/index.ts` strips `Authorization` from upstream requests (`allowedRequestHeaders`, ~line 263). So clone
auth can't work until the proxy forwards it. Two proxy changes:

1. Add `authorization` to `allowedRequestHeaders` so it reaches `github.com` (already host-restricted to
   github/gitlab/bitbucket).
2. **Do not cache authed responses.** The `/info/refs` v1 cache is keyed by URL only; caching a private repo's refs
   would leak them to the next requester of the same URL. Gate `shouldCache` on the absence of an `Authorization`
   header. Also forward `www-authenticate` on responses so isomorphic-git's 401→onAuth retry is robust.

### Token storage — `src/lib/github-token.svelte.ts` (new)

Reactive Svelte 5 module (`$state`) so the header icon and popup update live. Backed by localStorage under
`gitstrata-github-token`, value `{ token, account, addedAt }` (ISO date).

- `githubToken` — reactive getter for the stored entry (or `undefined`).
- `saveGithubToken(token)` — verifies via `verifyGithubToken`, stores `{ token, account, addedAt }`, updates state.
- `deleteGithubToken()` — clears storage + state.
- `maskToken(token)` — `ghp_…<last 4>` style for display (never show the full token after entry).
- `verifyGithubToken(token)` — `GET https://api.github.com/user` with `Authorization: Bearer <token>`; returns
  `{ login }` or throws a friendly error.

localStorage isn't available in the worker, so the page reads the token and passes it into
`analyze`/`analyzeIncremental`.

### Proxy-trust helper — `src/lib/cors-proxy.ts` (new, small)

`isSelfHostedProxy(corsProxy)` → `corsProxy !== 'https://cors.isomorphic-git.org'`. A configured `PUBLIC_CORS_PROXY_URL`
implies self-hosting; the literal public fallback is the only untrusted value. Used to gate the key UI.

### Threading the token to the clone

- `analyzer.api.ts` + worker `analyze`/`analyzeIncremental`: add an optional `githubToken?: string` param.
- `clone.ts` `detectDefaultBranch` / `cloneRepo` / `fetchRepo`: accept the token; replace
  `onAuth: () => ({ cancel: true })` with
  `onAuth: () => token ? { username: token, password: 'x-oauth-basic' } : { cancel: true }`. isomorphic-git fires
  `onAuth` on a 401 and retries with Basic auth — the GitHub PAT pattern.
- `+page.svelte`: only pass the token when `parseRepoUrl(input).host === 'github.com'` and
  `isSelfHostedProxy(corsProxy)`. It's a GitHub token; don't send it to other hosts.

### UI

- **`GithubKeyForm.svelte` (new)** — the shared add-key form, with a `compact` prop. Contents:
    - What this does + that it stays on your device, link to create a fine-grained PAT
      (`https://github.com/settings/personal-access-tokens/new`), the exact permission (`Contents: read-only`, all or
      selected repos).
    - Privacy line (accurate transit wording) + "verify in the source" link to
      `https://github.com/vdavid/gitstrata/blob/main/src/lib/github-token.svelte.ts`.
    - Token input + Save (runs `saveGithubToken`, shows verify spinner, surfaces errors).
    - When `!isSelfHostedProxy`: replace the form with a short "needs a self-hosted proxy" explainer + link to
      `docs/deploying.md`.
- **`GithubKeyManager.svelte` (new)** — header popup between the GitHub and theme-toggle icons.
    - Key icon button; when a token is stored, a small bottom-right checkmark badge (inline SVG, `currentColor`, no
      color accent).
    - Click toggles a dropdown; click-away (window listener / action) closes it.
    - Stored state: masked token, `@account`, "Added <ISO date>", "Delete key" button.
    - Empty state: `GithubKeyForm compact`.
- **`+page.svelte` error card** — when `errorKind === 'auth-required'`: render `GithubKeyForm` (trusted proxy) or the
  self-hosted explainer (untrusted), plus a Retry that re-runs analysis (now with the saved token).

## Testing

- `github-token` module: save/get/delete, `maskToken`, `verifyGithubToken` (mock fetch — success + 401).
- `cors-proxy.ts`: `isSelfHostedProxy` truth table.
- `cors-proxy/src/index.test.ts`: Authorization forwarded upstream; authed `/info/refs` not cached; `www-authenticate`
  passed through.
- Manual: private repo on a self-hosted-proxy build clones with a valid token; public-proxy build shows the explainer.

## Docs

- Update `cors-proxy/CLAUDE.md` (header allowlist now includes `authorization`; no-cache-when-authed rule).
- Update `src/lib/CLAUDE.md` (new `github-token` module + token threading through clone/worker).
- Keep this plan in sync; remove when shipped (git remembers).

## Task list

### Milestone 1 — Proxy

- [x] Forward `authorization` upstream in `cors-proxy/src/index.ts`
- [x] Skip caching when an `Authorization` header is present; forward `www-authenticate`
- [x] Update `cors-proxy/src/index.test.ts`; update `cors-proxy/CLAUDE.md`

### Milestone 2 — Storage + verification

- [x] `src/lib/github-token.svelte.ts` (state, save/get/delete, mask, verify)
- [x] `src/lib/cors-proxy.ts` `isSelfHostedProxy`
- [x] Unit tests for both

### Milestone 3 — Clone wiring

- [x] Thread `githubToken` through `analyzer.api.ts` + worker `analyze`/`analyzeIncremental`
- [x] `onAuth` token in `detectDefaultBranch`/`cloneRepo`/`fetchRepo`
- [x] Pass token from `+page.svelte` (GitHub host + self-hosted proxy only)

### Milestone 4 — UI

- [x] `GithubKeyForm.svelte` (shared, `compact` prop, trusted/untrusted states)
- [x] `GithubKeyManager.svelte` header popup (icon, checkmark badge, click-away, stored/empty states)
- [x] Wire into `+layout.svelte` header and the `auth-required` error card in `+page.svelte`

### Milestone 5 — Wrap-up

- [x] Update `src/lib/CLAUDE.md`
- [x] `./scripts/check.sh` green
- [x] Manual verification (private repo clone, public-proxy explainer) </content> </invoke>
