# Shared results cache

Cache processed `AnalysisResult` data on the server so any user benefits from previous analyses. Only compute the diff.

## Current state

- **Client cache (IndexedDB)**: Stores `AnalysisResult` per repo URL with LRU eviction at 500 MB. No TTL — data lives
  until evicted. Per-browser, not shared.
- **CORS proxy cache (Cloudflare Cache API)**: Caches `/info/refs` GET responses for 12 hours. This determines how
  quickly the client discovers new commits. Per-datacenter.
- **Incremental analysis**: Already implemented (`analyzeIncremental`). Fetches new commits, processes only new days,
  merges with cached days.
- **No server-side results storage**: The CORS proxy is stateless (just forwards bytes).

## Goal

When user A analyzes `facebook/react`, the result is stored server-side. When user B requests the same repo hours or
days later, they get the cached result instantly, and the client only processes any commits that landed since the cache
was written.

## Design

### Opt-in — everything is optional

The shared cache is fully opt-in on both sides:

- **Server**: The CORS proxy cache routes only activate when an R2 bucket binding (`RESULTS`) is present in the worker
  environment. Without it, the routes return 404 and the proxy behaves exactly as before.
- **Client**: A `PUBLIC_SHARED_CACHE_URL` env var points the frontend at the cache endpoints. When unset (the default),
  the client skips all server cache calls — no fetches, no uploads, no errors. The app works identically to today.

This means you can deploy without R2 and everything works. When you're ready, create the bucket, add the binding, set
the env var, and the shared cache lights up.

### Storage: Cloudflare R2

Add an R2 bucket to the existing CORS proxy worker (same `wrangler.toml`). R2 is ideal because:

- Free egress (no cost for reads).
- $0.015/GB/month storage — 100k repos at 1 MB average = 100 GB = $1.50/month.
- S3-compatible, but we use the Workers binding API (no SDK needed).
- Same worker, same deployment, no new service.

**Object key**: `results/v1/{sha256(normalized-repo-url)}.json.gz` (gzip-compressed JSON).

**Stored payload**:

```ts
interface SharedCacheEntry {
    version: 1
    repoUrl: string
    headCommit: string // OID of HEAD at analysis time — for freshness check
    result: AnalysisResult
    updatedAt: string // ISO 8601
}
```

### New API endpoints on the CORS proxy

Two new routes, same Cloudflare Worker:

| Method | Path                  | Purpose                     |
| ------ | --------------------- | --------------------------- |
| GET    | `/cache/v1/:repoHash` | Fetch cached result         |
| PUT    | `/cache/v1/:repoHash` | Upload/update cached result |

**GET** returns the gzip-compressed JSON or 404. Headers: `Content-Encoding: gzip`, `Cache-Control: public, max-age=300`
(5-minute edge cache to reduce R2 reads for popular repos).

**PUT** accepts gzip-compressed JSON. Validations before storing:

- Request body < 10 MB (reject oversized payloads).
- JSON shape matches `SharedCacheEntry` (version, repoUrl, result with days array).
- `repoUrl` hashes to the `:repoHash` in the path (prevents key mismatch).
- Rate limit: same IP-based limiter, maybe tighter for writes (10/min).

### Trust model

Since all repos are public and results are deterministic for the same commit, any client's result is valid. A malicious
client could upload garbage, but:

- Shape validation catches structural issues.
- The `headCommit` field lets clients verify freshness against actual git refs.
- Worst case: a user sees wrong line counts until someone re-analyzes. Low stakes for a free tool.
- If abuse becomes a problem later, we could add HMAC signing or require the client to prove it cloned the repo (send a
  tree hash the server can verify against `/info/refs`).

### Client-side flow changes

```
User enters repo URL
    |
    v
1. Check local IndexedDB cache
   |-- HIT --> show immediately, done (existing behavior, unchanged)
   |-- MISS --> continue
   v
2. Is PUBLIC_SHARED_CACHE_URL set?
   |-- NO  --> skip to step 3 (today's behavior, no server calls)
   |-- YES --> check server cache: GET /cache/v1/{hash}
               |-- 404 or error --> continue to step 3
               |-- 200 --> got SharedCacheEntry, go to step 4
   v
3. Full clone + analyze (existing behavior)
   Then if shared cache is enabled, PUT result to server cache
   Save to local IndexedDB, done
   v
4. Quick freshness check: compare entry.headCommit with current HEAD
   (HEAD comes from /info/refs, already fetched during default branch detection)
   |-- matches --> result is current, show it, save to IndexedDB, done
   |-- differs --> use result as base for incremental analysis
   v
5. Incremental analysis (existing analyzeIncremental)
   Process only days after last cached date
   Upload updated result to server cache (PUT)
   Save to local IndexedDB
```

### What changes where

**`cors-proxy/src/index.ts`** — Add two routes (`GET /cache/v1/:id`, `PUT /cache/v1/:id`), guarded by an R2 binding
check. If `env.RESULTS` (the R2 binding) doesn't exist, the routes return 404. Keep existing git proxy routes unchanged.

**`cors-proxy/wrangler.toml`** — Optionally add R2 bucket binding (not added by default):

```toml
# Uncomment to enable the shared results cache
# [[r2_buckets]]
# binding = "RESULTS"
# bucket_name = "git-strata-results"
```

**`src/lib/types.ts`** — Add `headCommit: string` to `AnalysisResult`. This is the HEAD OID at analysis time. Needed for
freshness checking even without the server cache (it tells us whether anything changed since last analysis).

**`src/lib/worker/analyzer.worker.ts`** — After `detectDefaultBranch`, resolve the HEAD commit OID and include it in the
result. During incremental, update it.

**New `src/lib/server-cache.ts`** — Server cache client. All functions check `PUBLIC_SHARED_CACHE_URL` first and no-op
when it's unset. Exports `fetchServerResult(repoUrl)` and `uploadServerResult(entry)`. Errors are caught internally and
never propagate — a failed server cache call just means the client falls back to its normal flow.

**`src/routes/+page.svelte`** — Update `startAnalysis` to check server cache on local miss (only when
`PUBLIC_SHARED_CACHE_URL` is set), and upload results after analysis.

### Cache lifecycle

```
First user analyzes repo
  → Result stored in R2 with headCommit = abc123
  → Result stored in their IndexedDB

Second user requests same repo (minutes/days/weeks later)
  → IndexedDB miss
  → Server cache hit: gets result with headCommit = abc123
  → Fetches /info/refs → current HEAD = def456 (new commits exist)
  → Runs analyzeIncremental from cached base
  → Uploads updated result (headCommit = def456) to R2
  → Stores in IndexedDB

Third user requests same repo (same day, no new commits)
  → IndexedDB miss
  → Server cache hit: headCommit = def456
  → /info/refs → HEAD still def456
  → Shows result instantly, no clone needed at all
```

### Edge cases

- **Concurrent writes**: Last-write-wins. Results are deterministic, so both writes produce the same data for the same
  HEAD commit. If HEAD differs, the later write with newer HEAD is correct.
- **Force push / rewritten history**: The `headCommit` won't match, triggering incremental analysis. But if history was
  rewritten, the incremental merge may have stale days. Mitigation: if the cached `days` array has dates after the
  repo's actual first commit but the commits don't match, fall back to full analysis. This is an edge case we can punt
  on initially.
- **Very large results**: R2 has no per-object size limit (up to 5 TB), but we cap uploads at 10 MB on the proxy side.
  Most repos produce results well under 1 MB.
- **R2 costs**: Free tier includes 10 million reads/month and 1 million writes/month. More than enough.
- **Stale cache for rapidly-changing repos**: The 12h `/info/refs` cache means even with the server results cache, users
  won't see commits newer than 12 hours. This is unchanged from current behavior.

### What this doesn't change

- All git operations and line counting still happen client-side.
- The CORS proxy remains mostly stateless (R2 is just blob storage, no compute).
- Local IndexedDB cache continues to work as-is (first check, fastest path).
- The incremental analysis logic is unchanged.

## Tasks

### Milestone 1: Server-side cache infrastructure

- [ ] Create R2 bucket `git-strata-results` in Cloudflare dashboard
- [ ] Add R2 binding to `cors-proxy/wrangler.toml`
- [ ] Add `GET /cache/v1/:repoHash` route to CORS proxy (read from R2, return gzipped JSON)
- [ ] Add `PUT /cache/v1/:repoHash` route with validation (shape check, size limit, rate limit)
- [ ] Add tests for the new routes

### Milestone 2: Client integration

- [ ] Add `headCommit` field to `AnalysisResult` type
- [ ] Populate `headCommit` in `analyze` and `analyzeIncremental` (resolve HEAD OID after branch detection)
- [ ] Add server cache client module (`src/lib/server-cache.ts`: `fetchServerResult`, `uploadServerResult`)
- [ ] Update `startAnalysis` flow: on local miss, check server cache before cloning
- [ ] Upload results to server after successful analysis
- [ ] Handle server cache errors gracefully (never block the user — fall back to full analysis)

### Milestone 3: Polish and testing

- [ ] Add integration tests for the full flow (local miss → server hit → incremental)
- [ ] Add subtle UI indicator when result came from shared cache (for example, "Cached result from 3 days ago")
- [ ] Update CORS proxy CLAUDE.md with new routes and R2 binding
- [ ] Update src/lib/CLAUDE.md with server cache module docs
- [ ] Run full check suite
