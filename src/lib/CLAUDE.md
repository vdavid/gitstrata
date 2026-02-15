# src/lib — Core pipeline

This directory contains the browser-based git analysis pipeline. All git operations and line counting
run client-side in a Web Worker.

## Module overview

- `types.ts` — Shared interfaces: LanguageDefinition, LanguageCount, DayStats, AnalysisResult
  (includes `headCommit` for freshness checking), SharedCacheEntry, ProgressEvent
- `languages.ts` — Language registry (~35 languages), extension mapping, test file/dir pattern matching,
  Rust inline test detection. `.h` defaults to C but reassigns to C++ when `.cpp`/`.cc`/`.cxx` files exist.
- `url.ts` — Repo URL parsing and normalization (GitHub/GitLab/Bitbucket, owner/repo shorthand)
- `cache.ts` — IndexedDB results cache using `idb`, with size tracking, LRU eviction (500 MB limit),
  and `formatBytes` helper
- `server-cache.ts` — Shared server cache client. Opt-in via `PUBLIC_SHARED_CACHE_URL` env var;
  all functions no-op when unset. Exports `fetchServerResult(repoUrl)` and
  `uploadServerResult(result)`. Errors are caught internally and never propagate. Uses SHA-256
  for repo URL hashing and CompressionStream for gzip upload.
- `git/clone.ts` — Clone/fetch using isomorphic-git + lightning-fs, default branch detection via
  `listServerRefs` (protocol v2), abortable HTTP wrapper for signal support, size-warning emission
  for repos >1 GB
- `git/history.ts` — Commit log grouped by date, consecutive date generation, gap filling
- `git/count.ts` — Line counting per commit tree, prod/test classification, blob dedup caching.
  Files with unrecognized extensions are counted under the `'other'` language bucket as prod code.
  Blob reads are parallelized with a concurrency limit of 8 using an inline `createLimiter` utility
  (no external dependency). Both `countLinesForCommit` (full tree walk) and
  `countLinesForCommitIncremental` (diff-based) process files in parallel via `processFile`, then
  aggregate results sequentially. Supports diff-based incremental processing via
  `countLinesForCommitIncremental`, which uses custom tree traversal with `git.readTree` + an
  in-memory `treeCache` (`Map<treeOid, TreeEntry[]>`) to diff trees between consecutive commits.
  A shared `FileState` map tracks per-file OID, language, and line counts across commits.
- `worker/analyzer.worker.ts` — Web Worker entry point (Comlink), orchestrates full pipeline and
  incremental refresh (`analyzeIncremental` fetches only new commits, processes new days, merges)
- `worker/analyzer.api.ts` — Comlink wrapper for main thread consumption

## Key patterns

- `FsClient` from isomorphic-git is the filesystem type (lightning-fs implements it)
- isomorphic-git object cache: A shared `gitCache` object (`{}`) is created once per analysis run and
  passed via `cache:` to every `git.log`, `git.readCommit`, `git.readTree`, and `git.readBlob` call.
  This lets isomorphic-git cache parsed pack-file objects in memory, avoiding repeated IndexedDB reads.
  The `gitCache` operates at the low level (raw git object reads), while our custom `treeCache` and
  `blobCache`/`contentCache` operate at higher levels (parsed tree entries, line counts). All layers
  are complementary.
- Blob dedup: `contentCache` (OID -> content) avoids redundant reads; `blobCache` (OID+path -> result)
  avoids redundant classification. These Maps are safe for concurrent async access because JavaScript
  is single-threaded (Map operations are atomic between await points).
- Diff-based processing: After the first commit (full tree walk via `listFilesAtCommitCached`),
  subsequent commits use custom `diffTrees` recursive traversal with `git.readTree` to diff against
  the previous commit. An in-memory `treeCache` (`Map<treeOid, TreeEntry[]>`) shared across all
  commits eliminates redundant IndexedDB reads -- once a tree object is read, it is served from memory.
  Unchanged subtrees (same tree OID) are skipped instantly via OID comparison. A `fileStateMap`
  (path -> FileState) tracks current state and is updated incrementally.
  `computeDayStatsFromFileState` aggregates the map into DayStats.
- Date gaps are filled by carrying forward the previous day's stats with `comments: ["-"]`
- Languages without test heuristics have no prod/test split (LanguageCount.prod/test stay undefined)
- Cache exports backwards-compatible aliases (`cacheResult`, `getCachedResult`, etc.) alongside new
  names (`saveResult`, `getResult`, `deleteRepo`, `clearAll`)
- Incremental refresh: `analyzeIncremental` uses `git.fetch` + processes only days after last cached date
