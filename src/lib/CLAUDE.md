# src/lib — Core pipeline

This directory contains the browser-based git analysis pipeline. All git operations and line counting run client-side in
a Web Worker.

## Module overview

- `types.ts` — Shared interfaces: LanguageDefinition, LanguageCount, DayStats, AnalysisResult (includes `headCommit` for
  freshness checking), SharedCacheEntry, ProgressEvent
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
- `git/history.ts` — Commit log grouped by date, consecutive date generation, gap filling. `getCommitsByDate` fetches
  commits in batches (via `git.log` with `depth` parameter) to bound peak memory on large repos. A `CompactOidSet`
  deduplicates commits across batches — stores OIDs as 20-byte binary values in a flat Uint8Array-backed hash set (~4x
  smaller than `Set<string>` for 40-char hex OIDs). Supports `signal` for cancellation and `onProgress` for reporting
  processed commit counts.
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
  at tree-walk time, avoiding recursion into entire subtrees. Both are exported for testing.
- `worker/analyzer.worker.ts` — Web Worker entry point (Comlink), orchestrates full pipeline and incremental refresh
  (`analyzeIncremental` fetches only new commits, processes new days, merges)
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
  custom `diffTrees` recursive traversal with `git.readTree` to diff against the previous commit. The `treeCache`
  (`LruMap` with 10K cap) shared across all commits reduces redundant IndexedDB reads — once a tree object is read, it
  is served from memory (evicting least-recently-used entries when full). Unchanged subtrees (same tree OID) are skipped
  instantly via OID comparison. A `fileStateMap` (path -> FileState) tracks current state and is updated incrementally.
  `computeDayStatsFromFileState` aggregates the map into DayStats.
- Date gaps are filled by carrying forward the previous day's stats with `comments: ["-"]`
- `noTestSplit` languages have no prod/test split (LanguageCount.prod/test stay undefined). All other languages get test
  directory detection via `defaultTestDirPatterns`, even without explicit heuristics.
- `classifyFile` order: noTestSplit → test dir → test file pattern → inline detection → default prod
- Incremental refresh: `analyzeIncremental` uses `git.fetch` + processes only days after last cached date
