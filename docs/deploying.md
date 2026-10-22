# Deploying git strata

This guide covers deploying git strata from scratch on Cloudflare, with CI auto-deploying on every push to main.

## Prerequisites

1. A [Cloudflare account](https://dash.cloudflare.com/sign-up).
2. A GitHub repo with this codebase pushed (for example, `vdavid/gitstrata`).
3. Wrangler (the Cloudflare CLI) — included as a dev dependency in `cors-proxy/`. Run commands from that directory with
   `pnpm exec wrangler`, or install globally with `pnpm add -g wrangler`.

## Step 1: Authenticate wrangler

```bash
cd cors-proxy
pnpm exec wrangler login
```

This opens a browser window. Authorize wrangler to access your Cloudflare account.

## Step 2: Deploy the CORS proxy (Cloudflare Worker)

```bash
cd cors-proxy
pnpm install
pnpm run deploy
```

Note the deployed URL (something like `https://git-strata-cors-proxy.<your-subdomain>.workers.dev`). You'll need this
for the frontend config.

### What the proxy does

- Forwards requests to allowed git hosts only (GitHub, GitLab, Bitbucket)
- Only proxies git protocol paths (`/info/refs` and `/git-upload-pack`)
- Adds CORS headers so the browser can talk to git servers
- Rate limits to 100 requests per minute per IP
- When R2 is enabled: serves and accepts shared analysis results (see step 3)

## Step 3: Enable the shared results cache (R2)

The shared cache lets users benefit from each other's analyses. It's optional but recommended.

1. **Enable R2 in your Cloudflare account**: Go to the [Cloudflare dashboard](https://dash.cloudflare.com/) > **R2
   Object Storage** and follow the prompts to activate R2 (it's free-tier friendly).

2. **Create the bucket**:

    ```bash
    cd cors-proxy
    pnpm exec wrangler r2 bucket create git-strata-results
    ```

    The `RESULTS` binding to this bucket is already on in `cors-proxy/wrangler.toml`, so create the bucket before the
    next proxy deploy: deploying with a binding to a missing bucket fails.

3. **Mint write keys for your trusted devices.** Everyone can read the shared cache, but only devices holding a personal
   write key upload results (your laptop, your phone, a few friends). Anonymous visitors never upload. Mint one key per
   person or device:

    ```bash
    KEY=$(openssl rand -hex 24)
    printf %s "$KEY" | shasum -a 256   # the hash goes into the secret below
    ```

4. **Store the key hashes as a Worker secret**, comma-separated (only hashes live on the server):

    ```bash
    cd cors-proxy
    pnpm exec wrangler secret put WRITE_KEY_HASHES
    ```

    Paste for example `3f1c…a9,72be…04` when prompted. To add or revoke a key later, run the same command with the
    updated list. Without this secret, every cache upload gets 403.

5. **Hand each key off** by opening this link on the device: `https://gitstrata.com/#write-key=KEY`. The app saves the
   key in that browser's localStorage and removes it from the URL. The key popup (key icon, top right) then shows
   "Sharing key: on" with a **Remove** button. Results analyzed with a GitHub token (private repos) are never uploaded.

6. **Re-deploy the CORS proxy** so it picks up the R2 binding and secret:

    ```bash
    pnpm run deploy
    ```

The proxy stores uploads without parsing them (the free Workers plan allows 10 ms CPU per request), so it trusts key
holders for the content. See `cors-proxy/CLAUDE.md` for the checks it does run.

## Step 4: Create the Cloudflare Pages project (frontend)

```bash
cd cors-proxy
pnpm exec wrangler pages project create git-strata
```

This creates a Pages project named `git-strata`. The actual deployments happen from CI (step 6), not from this command.

## Step 5: Set up the custom domain

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), go to **Compute > Workers & Pages > git-strata > Custom
   domains**.
2. Add your domain (for example, `gitstrata.yourdomain.com`).
3. Cloudflare will auto-create the DNS record if your domain's DNS is managed by Cloudflare.

## Step 6: Set up CI (GitHub Actions)

The CI workflow at `.github/workflows/ci.yml` runs all checks on PRs and auto-deploys on push to main. It needs two
GitHub secrets.

### Create a Cloudflare API token

1. Go to [Cloudflare dashboard > My Profile > API Tokens](https://dash.cloudflare.com/profile/api-tokens).
2. Click **Create Token**.
3. Use the **Custom token** template with these permissions:
    - Account > Workers Scripts: Edit
    - Account > Cloudflare Pages: Edit
    - Account > R2 Storage: Edit (if using shared cache)
4. Copy the token.

### Find your account ID

Your account ID is on the right sidebar of any zone's overview page in the Cloudflare dashboard. Or run:

```bash
cd cors-proxy
pnpm exec wrangler whoami
```

### Add GitHub secrets

In your GitHub repo, go to **Settings > Secrets and variables > Actions** and add:

| Secret                  | Value                      |
| ----------------------- | -------------------------- |
| `CLOUDFLARE_API_TOKEN`  | The API token from above   |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

Once these are set, every push to `main` that passes CI will auto-deploy both the frontend and the CORS proxy.

### CI jobs overview

| Job               | Trigger                   | What it does                                 |
| ----------------- | ------------------------- | -------------------------------------------- |
| Detect changes    | Always                    | Skips irrelevant jobs based on changed files |
| Frontend          | Frontend files changed    | prettier, eslint, knip, svelte-check, vitest |
| CORS proxy        | cors-proxy/ files changed | Runs proxy tests                             |
| Scripts (Go)      | scripts/ files changed    | gofmt, go-vet, staticcheck, go-tests         |
| CI OK             | Always                    | Gate job for branch protection               |
| Deploy frontend   | Push to main, after CI OK | Builds and deploys to Cloudflare Pages       |
| Deploy CORS proxy | Push to main, after CI OK | Deploys worker to Cloudflare                 |

## Environment variables

| Variable                  | Where                        | Default                           | Purpose                                                                                    |
| ------------------------- | ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| `PUBLIC_CORS_PROXY_URL`   | Frontend (`.env`)            | `https://cors.isomorphic-git.org` | URL of your deployed CORS proxy                                                            |
| `PUBLIC_SHARED_CACHE_URL` | Frontend (`.env`)            | _(none)_                          | URL of shared cache API (same as CORS proxy when R2 is enabled)                            |
| `ALLOWED_ORIGINS`         | Worker (`wrangler.toml`)     | gitstrata.com, www + previews     | Comma-separated CORS allowlist (`https://*.host` wildcards OK); override in `.dev.vars`    |
| `WRITE_KEY_HASHES`        | Worker secret / `.dev.vars`  | _(none)_                          | Comma-separated SHA-256 hex digests of the personal write keys (see step 3)                |
| `PUBLIC_ANALYTICS_ID`     | Frontend (`.env`)            | _(none)_                          | Umami website ID (UUID from your Umami dashboard) — set to enable tracking                 |
| `ANALYTICS_UPSTREAM`      | Pages Function (runtime var) | git strata's Umami instance       | Your Umami server URL that `/u/*` proxies to (for example, `https://umami.yourdomain.com`) |

Cache writes need no frontend variable: each trusted device holds its own write key (see step 3).

Set `PUBLIC_ANALYTICS_ID` to enable analytics. When it's missing, no tracking script is loaded. The tracker loads
first-party from the Pages Function at `/u/*` (see `functions/CLAUDE.md`) so adblockers don't strip it — this dodges the
third-party analytics domain and the well-known `/script.js` filename, both on adblock blocklists. Set
`ANALYTICS_UPSTREAM` on the Pages project (Cloudflare dashboard > **Settings > Environment variables**) to point `/u/*`
at your own Umami host.

Frontend variables are declared in `src/env.ts` (SvelteKit's `defineEnvVars`) as static, so their values get inlined
into the bundle at build time. CI sets them in the `deploy-frontend` job in `ci.yml`. To add one, declare it in
`src/env.ts` and import it from `$app/env/public`. For local development, create a `.env` file in the repo root:

```bash
PUBLIC_CORS_PROXY_URL=https://your-proxy.workers.dev
# PUBLIC_SHARED_CACHE_URL=https://your-proxy.workers.dev
# PUBLIC_ANALYTICS_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

For local proxy dev, create `cors-proxy/.dev.vars`:

```bash
# Hash of a local test key, to try cache writes against `wrangler dev`
WRITE_KEY_HASHES=<sha256 hex of your test key>
```

## Local development

For local frontend development, you don't need to deploy anything. The dev server defaults to
`https://cors.isomorphic-git.org`, a free public CORS proxy.

```bash
pnpm install
pnpm dev
```

## Building locally

```bash
pnpm build
```

Outputs a static site to `build/`. This directory is plain HTML/CSS/JS and works on any static host (Vercel, Netlify, or
just a file server).
