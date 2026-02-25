# src/lib — Core pipeline

This directory contains the browser-based git analysis pipeline. All git operations and line counting run client-side in
a Web Worker.

## Module overview

- `types.ts` — Shared interfaces: LanguageDefinition, LanguageCount, DayStats (includes `authors` per day, optional
  `contributors` map of per-author cumulative line counts, and optional velocity fields
  `languageAdded`/`languageRemoved` /`contributorAdded`/`contributorRemoved` for per-day activity breakdown),
  AnalysisResult (includes `headCommit` for freshness checking and optional `totalContributors`), SharedCacheEntry,
  ProgressEvent
- `languages.ts` — Language registry (~35 languages), extension mapping, test file/dir pattern matching, Rust and Zig
  inline test detection. `.h` defaults to C but reassigns to C++ when `.cpp`/`.cc`/`.cxx` files exist. Languages can set
  `noTestSplit: true` to skip prod/test breakdown (used for HTML, CSS, SQL, Shell, Svelte, Vue, Astro, Docs, Config).
- `url.ts` — Repo URL parsing and normalization (GitHub/GitLab/Bitbucket, owner/repo shorthand)
- `cache.ts` — IndexedDB results cache using `idb`, with size tracking, LRU eviction (500 MB limit), and `formatBytes`
  helper. Uses a separate `results-meta` store for lightweight metadata (`repoUrl`, `analyzedAt`, `lastAccessed`,
  `sizeBytes`) so eviction, size checks, and listing never deserialize full results. The heavy `results` store is only
  read by `getResult`. DB version 2 added the meta store with a thin backfill migration. Writes are wrapped in try/catch
  to handle QuotaExceededError gracefully (caching is best-effort).
- `server-cache.ts` — Shared server cache client. Opt-in via `PUBLIC_SHARED_CACHE_URL` env var; all functions no-op when
  unset. Exports `fetchServerResult(repoUrl)` and `uploadServerResult(result)`. Errors are caught internally and never
  propagate. Uses SHA-256 for repo URL hashing and CompressionStream for gzip upload.
- `git/clone.ts` — Clone/fetch using isomorphic-git + lightning-fs, default branch detection via `listServerRefs`
  (protocol v2), abortable HTTP wrapper for signal support, size-warning emission for repos >1 GB. A `StalenessMonitor`
  wraps the external abort signal with an adaptive timeout: 5 min base, extended to 20 min once 10+ MB of data has been
  received (GitHub sends large packs in bursts). The UI detects silence internally via `PipelineProgress`.
- `git/history.ts` — Commit log grouped by date, consecutive date generation, gap filling. `CommitEntry` stores
  per-commit metadata (hash, author, message, timestamp, parentOids). `DailyCommit` includes an `authors` field with
  deduplicated `"Name <email>"` strings per day and a `commits: CommitEntry[]` array (sorted oldest-first) with every
  commit that day. `getCommitsByDate` fetches commits in batches (via `git.log` with `depth` parameter) to bound peak
  memory on large repos and accepts an optional `normalizeAuthor(name, email)` callback for mailmap normalization. A
  `CompactOidSet` deduplicates commits across batches — stores OIDs as 20-byte binary values in a flat Uint8Array-backed
  hash set (~4x smaller than `Set<string>` for 40-char hex OIDs). Supports `signal` for cancellation and `onProgress`
  for reporting processed commit counts.
- `git/mailmap.ts` — Lightweight .mailmap parser supporting all 4 forms (name-only, email-only, both by email, both by
  name+email). Exports `parseMailmap(content)`, `createMailmapLookup(entries)` (returns normalized "Name <email>" with
  most-specific-form-wins priority), and `readMailmapFromRepo(fs, dir, headRef, gitCache?)` which reads `.mailmap` from
  the repo root tree (returns `[]` if not found).
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
  (not the previous commit in timestamp order), returning `languageAdded`, `languageRemoved`, and totals.
- `worker/analyzer.worker.ts` — Web Worker entry point (Comlink), orchestrates full pipeline and incremental refresh
  (`analyzeIncremental` fetches only new commits, processes new days, merges). Both `analyze` and `analyzeIncremental`
  read `.mailmap` via `readMailmapFromRepo` and pass a `normalizeAuthor` callback to `getCommitsByDate`. `processDays`
  iterates individual commits within each day (via `DailyCommit.commits`), running incremental tree diffs per commit.
  Attribution uses `computeCommitContribution` to diff each commit against its git parent (not the previous commit in
  timestamp order), fixing incorrect deltas from interleaved branch commits. Merge commits (>1 parent) are skipped.
  Per-day velocity fields (`languageAdded`, `languageRemoved`, `contributorAdded`, `contributorRemoved`) are accumulated
  from individual commit contributions and written to `DayStats`. Gap days get empty velocity maps. Both pipelines
  compute `totalContributors` by collecting all unique authors across all days.
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
  classification across commits. `treeCache` (`LruMap`, 10K cap) bounds parsed tree entry storage. These Maps are safe
  for concurrent async access because JavaScript is single-threaded (Map operations are atomic between await points).
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
- Incremental refresh: `analyzeIncremental` uses `git.fetch` + processes only days after last cached date

## Components

- `components/ResultsChart.svelte` — Chart.js stacked area chart with a two-row toolbar. Row 1 has primary tabs
  (Languages / Contributors) using `strata-tab` + a Velocity toggle chip. Row 2 has sub-mode chips (visible in both
  cumulative and velocity modes): Languages tab shows All / Prod vs test / Languages only; Contributors tab shows All
  contributors / Top 10. A `buildContributorDatasets` function creates stacked areas per contributor (using the same
  mineral color palette by rank), with `computeVisibleContributors` filtering by >= 5% of total (all-contributors mode)
  or top 10. Contributor values are clamped to `Math.max(0, ...)`. The Contributors tab is disabled when
  `DayStats.contributors` data is unavailable. Velocity mode (`buildVelocityDatasets`) supports two rendering paths:
  when new per-language/contributor velocity fields (`languageAdded`, `languageRemoved`, `contributorAdded`,
  `contributorRemoved`) are available, it shows colored stacked area charts with 7-day rolling averages per category
  (activity = `Math.max(added, removed)` per language/contributor); when those fields are absent (old cached data), it
  falls back to monochrome daily change + 7-day average as two unfilled line datasets. In velocity mode, the "Prod vs
  test" sub-mode is treated as "Languages only" (no prod/test velocity split). A `rolling7DayAvg` helper computes
  windowed averages. The Y-axis uses `stacked: true` + `beginAtZero: true` for stacked velocity, and `stacked: false`
  for monochrome fallback velocity. An "Era markers" toggle (persisted to localStorage under `gitstrata-era-markers`)
  controls the `eraMarkersPlugin`. Pattern fills are hidden when velocity is enabled or contributors tab is active.
- `components/chart-era-markers-plugin.ts` — Chart.js plugin that draws vertical dashed lines at AI-era milestones
  (Copilot GA '22, Agentic era '25, Opus 4.5 '25). Only renders markers within the repo's date range. Reads CSS
  variables for colors and font.
- `components/ResultsSummary.svelte` — 6 summary stat cards: Total lines, Prod/test split, Average growth, Age, Peak
  day, Contributors. The Age card includes a "last active" line that appears when the last meaningful code change (>10
  non-meta lines delta) differs from the last commit date by >30 days. The Contributors card aggregates unique authors
  from `DayStats.authors` and shows top-N commit-day concentration.
