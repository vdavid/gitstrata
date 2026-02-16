# Commit processing speedup plan

Two sequential optimizations to speed up the "Processing commits" phase.

## 1. Diff-based processing

**Problem:** `countLinesForCommit` walks the full tree for every commit, even though most commits change only a handful
of files.

**Solution:** For every commit after the first, walk two trees (previous + current) and only process changed files.
Maintain a `fileStateMap: Map<path, { oid, languageId, lines, testLines }>` across iterations. Compute DayStats by
aggregating the map.

Key details:

- First commit: full tree walk (no previous commit to diff against), populate fileStateMap
- Subsequent commits: `git.walk({ trees: [TREE(prev), TREE(cur)] })`, compare OIDs
- When tree OIDs match, return `undefined` from walk callback to skip unchanged subtrees entirely
- Added/modified files: read blob, classify, update map
- Deleted files: remove from map
- Maintain a running set of all extensions for `.h` disambiguation via `resolveHeaderLanguage`
- DayStats computed from fileStateMap aggregation, not per-file accumulation
- Keep existing blobCache/contentCache for blob-level dedup (helps when files revert to previous versions)

Files to change:

- `src/lib/git/count.ts` — add `FileState`, `IncrementalContext`, `countLinesForCommitIncremental`,
  `computeDayStatsFromMap` helper
- `src/lib/worker/analyzer.worker.ts` — maintain fileStateMap + allExtensions in the loop, use incremental for commits
  after the first

## 2. Parallel blob reads

**Problem:** Blob reads inside `countLinesForCommit` (and the new incremental function) are sequential — one
`git.readBlob()` at a time.

**Solution:** Use `Promise.all` with a concurrency limiter to read multiple blobs in parallel. Since `readBlob` is async
I/O to lightning-fs/IndexedDB, parallelism helps.

Key details:

- Add `p-limit` (or implement a simple semaphore) for concurrency control
- Limit to ~8 concurrent reads (IndexedDB starts thrashing beyond that)
- Apply to both the full-tree path (first commit) and the incremental path

Files to change:

- `src/lib/git/count.ts` — parallelize the file processing loop
- `package.json` — add `p-limit` if used (or inline a tiny limiter to avoid a dependency)
