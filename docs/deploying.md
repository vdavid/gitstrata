# Deploying git strata

## Frontend

The frontend is a static SvelteKit site. Build it and deploy the output to any static hosting provider.

### Build

```bash
pnpm install
pnpm build
```

This outputs a static site to `build/`.

### Deploy to Cloudflare Pages

1. Push the repo to GitHub (or GitLab).
2. In the Cloudflare dashboard, go to **Workers & Pages > Create > Pages > Connect to Git**.
3. Select the repository and configure:
   - **Build command:** `pnpm build`
   - **Build output directory:** `build`
   - **Root directory:** `/` (the repo root, not `cors-proxy/`)
4. Add environment variables if needed (see below).
5. Deploy.

Cloudflare Pages will rebuild and deploy on every push to the default branch.

### Alternatives

The `build/` directory is plain HTML/CSS/JS with no server requirements. It works on:

- **Vercel** — set framework to "SvelteKit" or "Other", output directory `build`
- **Netlify** — build command `pnpm build`, publish directory `build`
- **Any static host** — just serve the `build/` folder

## CORS proxy

The CORS proxy is a Cloudflare Worker that forwards git protocol requests with CORS headers.
It lives in the `cors-proxy/` directory.

### Deploy to Cloudflare Workers

1. Install wrangler if you haven't:

   ```bash
   pnpm add -g wrangler
   ```

2. Authenticate with Cloudflare:

   ```bash
   wrangler login
   ```

3. Deploy:

   ```bash
   cd cors-proxy
   pnpm install
   pnpm run deploy
   ```

4. Note the deployed URL (something like `https://git-strata-cors-proxy.<your-subdomain>.workers.dev`).

5. Update the frontend to use your proxy URL (see environment variables below).

### What it does

- Forwards requests to git hosts (`/info/refs` and `/git-upload-pack` paths only)
- Adds `Access-Control-Allow-Origin: *` and other CORS headers
- Rate limits to 100 requests per minute per IP
- Rejects non-git URLs for security

### Local development

For local frontend development, you don't need to run the CORS proxy. The dev server defaults to
`https://cors.isomorphic-git.org`, a free public proxy.

## Environment variables

| Variable                | Where              | Default                                | Purpose                       |
| ----------------------- | ------------------ | -------------------------------------- | ----------------------------- |
| `PUBLIC_CORS_PROXY_URL` | Frontend (`.env`)  | `https://cors.isomorphic-git.org`      | URL of your deployed CORS proxy |
| `PUBLIC_ANALYTICS_ID`   | Frontend (`.env`)  | _(none)_                               | Optional analytics (e.g. Plausible) |

Create a `.env` file in the repo root for local overrides:

```bash
PUBLIC_CORS_PROXY_URL=https://your-proxy.workers.dev
```

For production, set these as environment variables in your hosting provider's dashboard.
