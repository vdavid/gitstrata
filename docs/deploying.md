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

3. **Uncomment the R2 binding** in `cors-proxy/wrangler.toml` (remove the `#` from the three `[[r2_buckets]]` lines).

4. **Set a cache write token** to prevent unauthorized cache writes:

    ```bash
    cd cors-proxy
    pnpm exec wrangler secret put CACHE_WRITE_TOKEN
    ```

    Enter a random secret when prompted (for example, generate one with `openssl rand -hex 32`). The frontend must send
    this token as a Bearer header on cache uploads — see the environment variables table below.

5. **Re-deploy the CORS proxy** so it picks up the R2 binding and secret:

    ```bash
    pnpm run deploy
    ```

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

| Variable                   | Where                        | Default                           | Purpose                                                         |
| -------------------------- | ---------------------------- | --------------------------------- | --------------------------------------------------------------- |
| `PUBLIC_CORS_PROXY_URL`    | Frontend (`.env`)            | `https://cors.isomorphic-git.org` | URL of your deployed CORS proxy                                 |
| `PUBLIC_SHARED_CACHE_URL`  | Frontend (`.env`)            | _(none)_                          | URL of shared cache API (same as CORS proxy when R2 is enabled) |
| `PUBLIC_CACHE_WRITE_TOKEN` | Frontend (`.env` / `ci.yml`) | _(none)_                          | Bearer token for cache writes (must match worker secret below)  |
| `ALLOWED_ORIGIN`           | Worker (`wrangler.toml`)     | `https://gitstrata.com`           | CORS origin restriction — override in `.dev.vars` for local dev |
| `CACHE_WRITE_TOKEN`        | Worker secret / `.dev.vars`  | _(none)_                          | Server-side token that cache PUT requests are checked against   |
| `PUBLIC_ANALYTICS_URL`     | Frontend (`.env`)            | _(none)_                          | Umami server URL (for example, `https://umami.yourdomain.com`)  |
| `PUBLIC_ANALYTICS_ID`      | Frontend (`.env`)            | _(none)_                          | Umami website ID (UUID from your Umami dashboard)               |

`PUBLIC_CACHE_WRITE_TOKEN` and `CACHE_WRITE_TOKEN` must have the same value. The frontend token is hard-coded in
`ci.yml` for production builds. The worker token is set via `wrangler secret put` (production) or `cors-proxy/.dev.vars`
(local dev).

Both `PUBLIC_ANALYTICS_URL` and `PUBLIC_ANALYTICS_ID` must be set to enable analytics. When either is missing, no
tracking script is loaded.

Frontend variables are set at build time in CI (see the `deploy-frontend` job in `ci.yml`). For local development,
create a `.env` file in the repo root:

```bash
PUBLIC_CORS_PROXY_URL=https://your-proxy.workers.dev
# PUBLIC_SHARED_CACHE_URL=https://your-proxy.workers.dev
PUBLIC_CACHE_WRITE_TOKEN=your-token-here
# PUBLIC_ANALYTICS_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# PUBLIC_ANALYTICS_URL=https://umami.yourdomain.com
```

For local proxy dev, create `cors-proxy/.dev.vars`:

```bash
CACHE_WRITE_TOKEN=your-token-here
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
