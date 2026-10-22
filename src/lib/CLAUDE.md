# src/lib — Core pipeline

This directory contains the browser-based git analysis pipeline. All git operations and line counting run client-side in
a Web Worker.

## Module overview

- `types.ts` — Shared interfaces: LanguageDefinition, LanguageCount, DayStats (includes `authors` per day, optional
  `contributors` map of per-author cumulative line counts, and optional velocity fields
  `languageAdded`/`languageRemoved` /`contributorAdded`/`contributorRemoved` for per-day activity breakdown),
  AnalysisResult (includes `headCommit` for freshness checking, optional `totalContributors`, and the roll-on guards
  `mailmapOid` (root `.mailmap` blob OID, `''` when absent) and `engineVersion`), SharedCacheEntry, ProgressEvent
- `languages.ts` — Language registry (~35 languages), extension mapping, test file/dir pattern matching, Rust and Zig
  inline test detection. `.h` is C, or C++ when the CURRENT commit tree holds a `.cpp`/`.cc`/`.cxx` file
  (`resolveHeaderLanguage(treeHasCppSources)` returns one of two prebuilt maps). Languages can set `noTestSplit: true`
  to skip prod/test breakdown (used for HTML, CSS, SQL, Shell, Svelte, Vue, Astro, Docs, Config).
- `url.ts` — Repo URL parsing and normalization (GitHub/GitLab/Bitbucket, owner/repo shorthand)
- `github-token.ts` — Pure (non-reactive) GitHub personal access token storage and verification. localStorage under
  `gitstrata-github-token` (`{ token, account, addedAt }`). `verifyGithubToken` hits `api.github.com/user` directly
  (CORS-enabled, no proxy) to confirm the token and capture the login. `maskToken` for display. The token is stored only
  on the device; it is sent to GitHub through the CORS proxy solely to authenticate private-repo clones.
- `github-token.svelte.ts` — Reactive singleton (`$state`) wrapping `github-token.ts`. Components read
  `githubTokenState.current`; `saveGithubToken`/`deleteGithubToken` mutate it. The worker can't read localStorage, so
  `+page.svelte` reads the token here and passes it into `analyze`. `Date` is constructed in the pure module
  (`makeTokenEntry`) to avoid the `svelte/prefer-svelte-reactivity` lint in `.svelte.ts`.
- `cors-proxy.ts` — `isSelfHostedProxy(corsProxy)` gates private-repo auth: a token is only sent when the deployment
  runs its own proxy (a configured `PUBLIC_CORS_PROXY_URL`), never through the shared public `publicProxyUrl` default.
- `cache.ts` — IndexedDB results cache using `idb`, with size tracking, LRU eviction (500 MB limit), and `formatBytes`
  helper. Uses a separate `results-meta` store for lightweight metadata (`repoUrl`, `analyzedAt`, `lastAccessed`,
  `sizeBytes`) so eviction, size checks, and listing never deserialize full results. The heavy `results` store is only
  read by `getResult`. DB version 2 added the meta store with a thin backfill migration. Writes are wrapped in try/catch
  to handle QuotaExceededError gracefully (caching is best-effort).
- `server-cache.ts` — Shared server cache client. Opt-in via `PUBLIC_SHARED_CACHE_URL` env var; all functions no-op when
  unset. Exports `fetchServerResult(repoUrl)` (anyone reads) and `uploadServerResult(result, { usedGithubToken })`,
  which only uploads from a trusted device (a write key is stored, see `write-key.ts`) and never when the analysis used
  a GitHub token (may be a private repo). The upload sends `Authorization: Bearer <write key>`, `X-Repo-Url`, and
  `X-Head-Commit` headers plus the gzip body: the proxy never parses the body (free-plan CPU budget, see
  `cors-proxy/CLAUDE.md`), so the headers are what it checks. Errors are caught internally and never propagate. Uses
  SHA-256 for repo URL hashing and CompressionStream for gzip upload. The upload resolves to whether the proxy stored it
  (feeds the `uploaded` analytics prop).
- `write-key.ts` — Pure storage for the personal shared-cache write key (localStorage `gitstrata-write-key`, every
  storage access in try/catch) and `takeWriteKeyFromHash`, which parses a `#write-key=KEY` handoff link.
  `write-key.svelte.ts` is the reactive wrapper (`writeKeyState.current`, `deleteWriteKey`, `adoptWriteKeyFromUrl`).
  `+layout.svelte` calls `adoptWriteKeyFromUrl` on mount: it saves the key and strips it from the URL with
  `history.replaceState`. `GithubKeyManager.svelte` shows a "Sharing key: on" row with **Remove** when a key is set.
- `git/clone.ts` — Clone/fetch using isomorphic-git + lightning-fs, default branch detection via `listServerRefs`
  (protocol v2), abortable HTTP wrapper for signal support, size-warning emission for repos >1 GB. A `StalenessMonitor`
  wraps the external abort signal with an adaptive timeout: 5 min base, extended to 20 min once 10+ MB of data has been
  received (GitHub sends large packs in bursts). The UI detects silence internally via `PipelineProgress`. An optional
  `githubToken` threads through `detectDefaultBranch`/`cloneRepo`/`fetchRepo` (and the worker
  `analyze`/`analyzeIncremental`) into isomorphic-git's `onAuth`, which fires on a 401 and retries with Basic auth
  (`{ username: token, password: 'x-oauth-basic' }`) to clone private repos.
- `git/history.ts` — Commit log grouped by date, consecutive date generation, gap filling. `CommitEntry` stores
  per-commit metadata (hash, author, message, timestamp, parentOids). `DailyCommit` includes an `authors` field with
  deduplicated `"Name <email>"` strings per day and a `commits: CommitEntry[]` array (sorted oldest-first) with every
  commit that day. `getCommitsByDate` fetches commits in batches (via `git.log` with `depth` parameter) to bound peak
  memory on large repos and accepts an optional `normalizeAuthor(name, email)` callback for mailmap normalization. A
  `CompactOidSet` deduplicates commits across batches — stores OIDs as 20-byte binary values in a flat Uint8Array-backed
  hash set (~4x smaller than `Set<string>` for 40-char hex OIDs). Supports `signal` for cancellation and `onProgress`
  for reporting processed commit counts. `collectAncestorOids` shares the same batched walk and returns the
  `CompactOidSet` of everything reachable from a ref (roll-on uses it to find new commits).
- `git/mailmap.ts` — Lightweight .mailmap parser supporting all 4 forms (name-only, email-only, both by email, both by
  name+email). Exports `parseMailmap(content)`, `createMailmapLookup(entries)` (returns normalized "Name <email>" with
  most-specific-form-wins priority), and `readMailmapFromRepo(fs, dir, headRef, gitCache?)` which reads `.mailmap` from
  the repo root tree (returns `[]` if not found). `readMailmapOid` returns the blob OID (`''` if none). Both resolve
  `headRef` first. Gotcha/Why: `git.readCommit` takes an OID only, so passing a branch name used to throw inside the try
  and silently disable `.mailmap`.
- `git/count.ts` — Line counting per commit tree, prod/test classification, blob dedup caching. Also exports `LruMap`, a
  Map subclass with LRU eviction used to bound cache memory. Files with unrecognized extensions are counted under the
  `'other'` bucket (with test-dir detection). Blob reads are parallelized with a concurrency limit of 8 using an inline
  `createLimiter` utility (no external dependency). Both `countLinesForCommit` (full tree walk) and
  `countLinesForCommitIncremental` (diff-based) process files in parallel via `processFile`, then aggregate results
  sequentially. Supports diff-based incremental processing via `countLinesForCommitIncremental`, which uses custom tree
  traversal with `git.readTree` + an in-memory `treeCache` (`LruMap<treeOid, TreeEntry[]>`, 10K cap) to diff trees
  between consecutive commits. A shared `FileState` map tracks per-file OID, language, and line counts across commits.
  Skip logic: `shouldSkip` filters individual files (lock files, minified output, protobuf/codegen, binary extensions)
  and `shouldSkipDir` filters vendored directories (`vendor`, `node_modules`, `Pods`, `bower_components`, `__pycache__`)
  at tree-walk time, avoiding recursion into entire subtrees. Both are exported for testing. `diffTreesDetailed`
  recursively diffs two tree OIDs and returns a discriminated union of diff entries (added/modified/deleted) with path
  and relevant OIDs. `countLinesForCommitIncremental` delegates to `diffTreesDetailed` internally.
  `computeCommitContribution` (exported) computes per-language lines added/removed for a single commit vs its git parent
  (not the previous commit in timestamp order), returning `languageAdded`, `languageRemoved`, and totals. It takes
  `treeHasCppSources` for the commit being attributed and classifies BOTH diff sides with that `.h` mapping, so a C/C++
  flip alone never shows up as activity.
- Classification is a pure function of each commit's tree (regression anchor: `tests/roll-on.test.ts` "C/C++ header
  classification"). `TreeLanguageState.cppSourceCount` counts `.cpp`/`.cc`/`.cxx` paths in the current tree: set by the
  full count, then kept in step with `fileStateMap` by the incremental diff (added +1, deleted −1). When the count
  crosses zero, `countLinesForCommitIncremental` reclassifies every unchanged `.h` entry through `processFile` (rare, so
  re-reading blobs is fine). Decision/Why: an earlier accumulated-across-history extension set plus a language-blind
  `blobCache` made a day's counts depend on processing order and cache pressure, so roll-on could disagree with a full
  run.
- `git/pipeline.ts` — Analysis of an already cloned repo on any `FsClient` (node fs in tests, LightningFS in the
  worker). `analyzeLocalRepo` runs the full history; `rollOnAnalysis` rolls a cached result forward (see "Roll-on
  refresh" below). Both share one `processDays` with a seedable `ProcessingState`. Reads `.mailmap` via
  `readMailmapFromRepo` and passes a `normalizeAuthor` callback to `getCommitsByDate`. `countingEngineVersion` (from
  `engine-version.ts`) is stored on every result. Tests: `tests/roll-on.test.ts`.
- `worker/analyzer.worker.ts` — Web Worker entry point (Comlink): network and LightningFS around `git/pipeline.ts`.
  `analyze` detects the branch, clones, then `analyzeLocalRepo`. `analyzeIncremental` fetches into the persisted clone
  (or clones when this device has none), moves the local branch ref to the fetched `refs/remotes/origin/<branch>`
  (`git.fetch` alone only moves the remote-tracking ref), then `rollOnAnalysis`. `getRemoteHead` is the cheap freshness
  check (`getRemoteBranchHead` in `clone.ts`: one `listServerRefs` request). `processDays` iterates individual commits
  within each day (via `DailyCommit.commits`), running incremental tree diffs per commit. Attribution uses
  `computeCommitContribution` to diff each commit against its git parent (not the previous commit in timestamp order),
  fixing incorrect deltas from interleaved branch commits. Merge commits (>1 parent) are skipped. Per-day velocity
  fields (`languageAdded`, `languageRemoved`, `contributorAdded`, `contributorRemoved`) are accumulated from individual
  commit contributions and written to `DayStats`. Gap days get empty velocity maps. Both pipelines compute
  `totalContributors` by collecting all unique authors across all days.
- `worker/analyzer.api.ts` — Comlink wrapper for main thread consumption

## Key patterns

- `FsClient` from isomorphic-git is the filesystem type (lightning-fs implements it)
- isomorphic-git object cache: A shared `gitCache` object (`{}`) is created once per analysis run and passed via
  `cache:` to every `git.log`, `git.readCommit`, `git.readTree`, and `git.readBlob` call. This lets isomorphic-git cache
  parsed pack-file objects in memory, avoiding repeated IndexedDB reads. The `gitCache` operates at the low level (raw
  git object reads), while our custom `treeCache` and `blobCache`/`contentCache` operate at higher levels (parsed tree
  entries, line counts). All layers are complementary.
- Blob dedup: `contentCache` (OID -> decoded UTF-8 content) avoids redundant reads within a single commit — cleared
  after each commit to bound memory. `blobCache` (`LruMap`, 100K cap, OID+path -> result) avoids redundant
  classification across commits; its key includes the language ID because the same `.h` blob is C in one tree and C++ in
  another. `treeCache` (`LruMap`, 10K cap) bounds parsed tree entry storage. These Maps are safe for concurrent async
  access because JavaScript is single-threaded (Map operations are atomic between await points).
- Non-UTF-8 handling: `processFile` uses `TextDecoder('utf-8', { fatal: true })`. On decode failure, line counts are
  computed from raw bytes (0x0A counting) and inline test detection is skipped.
- Diff-based processing: After the first commit (full tree walk via `listFilesAtCommitCached`), subsequent commits use
  `diffTreesDetailed` for recursive tree diffing with `git.readTree` against the previous commit. The `treeCache`
  (`LruMap` with 10K cap) shared across all commits reduces redundant IndexedDB reads — once a tree object is read, it
  is served from memory (evicting least-recently-used entries when full). Unchanged subtrees (same tree OID) are skipped
  instantly via OID comparison. A `fileStateMap` (path -> FileState) tracks current state and is updated incrementally.
  `computeDayStatsFromFileState` aggregates the map into DayStats.
- Date gaps are filled by carrying forward the previous day's stats with `comments: ["-"]` and `authors: []`
- `noTestSplit` languages have no prod/test split (LanguageCount.prod/test stay undefined). All other languages get test
  directory detection via `defaultTestDirPatterns`, even without explicit heuristics.
- `classifyFile` order: noTestSplit → test dir → test file pattern → inline detection → default prod
- Roll-on refresh (`rollOnAnalysis`), exact by design (equals a full analysis of the new history):
    - Same HEAD as cached: return the cached result (new `analyzedAt`).
    - Full recompute from the local clone (no re-clone) when `engineVersion` differs or is missing, the cached HEAD is
      not an ancestor of the new HEAD (force push, or missing objects), or `mailmapOid` differs or is missing (a
      `.mailmap` change rewrites past authors).
    - Otherwise, new commits = reachable from new HEAD but not from cached HEAD. Days are bucketed by AUTHOR date, so a
      merged branch can add commits to days long before the last cached day. The first day bucket holding a new commit
      is the earliest affected day; the bucket before it is the seed. Cached days up to the seed are kept verbatim; the
      seed's last commit gets one full tree count (`fileStateMap`, `treeLanguage`), contributors are seeded from the
      cached seed day, and `processDays` recounts everything after the seed (including gap days). Because classification
      depends only on the current tree, the seed count matches the full run's state exactly.
- `+page.svelte` wiring: On a local cache hit, the page checks the remote HEAD in the background (`getRemoteHead`); when
  it moved, it goes through `refreshFromBestSource`, as does the Refresh button (which fetches the remote HEAD first).
  That fetches the shared entry and asks `pickRefreshPlan` (`refresh-plan.ts`, pure, tested in
  `tests/refresh-plan.test.ts`): adopt a shared result already at the remote HEAD with the current `engineVersion` (show
  it, save locally, no roll-on, no upload), else roll on (`analyzeIncremental`) from the fresher of (shown, shared),
  preferring a current-engine base. Decision/Why: a phone with an old local copy used to roll on itself, often with a
  full clone, while the laptop had already uploaded the fresh result. A server hit on a local miss shows the entry
  without auto-cloning even when it's stale; Refresh then rolls it on. During a roll-on the chart stays visible with
  `PipelineProgress` above it, silent failures keep the cached chart, and the `done` event saves to IndexedDB and
  uploads to the shared cache like a full run.
- `analytics.ts` — `trackEvent(name, props)`, a typed no-throw wrapper around Umami's `window.umami?.track`, and
  `repoLabel(repoUrl)`. The event list lives in `functions/CLAUDE.md` § Custom events.
- `engine-version.ts` — `countingEngineVersion` (bump whenever counting rules change). Separate from `git/pipeline.ts`
  so the page reads it without bundling isomorphic-git.

## Components

- `components/ResultsChart.svelte` — Chart.js stacked area chart with a two-row toolbar. Row 1 has primary tabs
  (Languages / Contributors) using `strata-tab` + a Velocity toggle chip. Row 2 has sub-mode chips that work in both
  cumulative and velocity modes: Languages tab shows All / Prod vs test / Languages only; Contributors tab shows All
  contributors / Top 10. A `buildContributorDatasets` function creates stacked areas per contributor (using the same
  mineral color palette by rank), with `computeVisibleContributors` filtering by >= 5% of total (all-contributors mode)
  or top 10. Contributor values are clamped to `Math.max(0, ...)`. The Contributors tab is disabled when
  `DayStats.contributors` data is unavailable. Velocity mode (`buildVelocityDatasets`) respects language sub-modes:
  "All" splits per-language velocity into prod/test layers (derived from consecutive cumulative values), "Prod vs test"
  shows two aggregate stacks (Production/Test velocity), and "Languages only" shows per-language activity
  (`Math.max(added, removed)`). When velocity fields (`languageAdded`, `languageRemoved`) are absent (old cached data),
  it falls back to a monochrome daily change line dataset. The Y-axis uses `stacked: true` + `beginAtZero: true` for
  stacked velocity, and `stacked: false` for monochrome fallback velocity. An "Era markers" toggle (persisted to
  localStorage under `gitstrata-era-markers`) controls the `eraMarkersPlugin`. Pattern fills are hidden when velocity is
  enabled or contributors tab is active.
- `components/chart-era-markers-plugin.ts` — Chart.js plugin that draws vertical dashed lines at AI-era milestones
  (Copilot GA '22, Agentic era '25, Opus 4.5 '25). Only renders markers within the repo's date range. Reads CSS
  variables for colors and font.
- `components/ResultsSummary.svelte` — 6 summary stat cards: Total lines, Prod/test split, Average growth, Age, Peak
  day, Contributors. The Age card includes a "last active" line that appears when the last meaningful code change (>10
  non-meta lines delta) differs from the last commit date by >30 days. The Contributors card aggregates unique authors
  from `DayStats.authors` and shows top-N commit-day concentration.
