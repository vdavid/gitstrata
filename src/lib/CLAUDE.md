# src/lib — Core pipeline

This directory contains the browser-based git analysis pipeline. All git operations and line counting
run client-side in a Web Worker.

## Module overview

- `types.ts` — Shared interfaces: LanguageDefinition, LanguageCount, DayStats, AnalysisResult, ProgressEvent
- `languages.ts` — Language registry (~35 languages), extension mapping, test file/dir pattern matching,
  Rust inline test detection. `.h` defaults to C but reassigns to C++ when `.cpp`/`.cc`/`.cxx` files exist.
- `url.ts` — Repo URL parsing and normalization (GitHub/GitLab/Bitbucket, owner/repo shorthand)
- `cache.ts` — IndexedDB results cache using `idb`
- `git/clone.ts` — Clone/fetch using isomorphic-git + lightning-fs, default branch detection via `getRemoteInfo`
- `git/history.ts` — Commit log grouped by date, consecutive date generation, gap filling
- `git/count.ts` — Line counting per commit tree, prod/test classification, blob dedup caching
- `worker/analyzer.worker.ts` — Web Worker entry point (Comlink), orchestrates the full pipeline
- `worker/analyzer.api.ts` — Comlink wrapper for main thread consumption

## Key patterns

- `FsClient` from isomorphic-git is the filesystem type (lightning-fs implements it)
- Blob dedup: `contentCache` (OID -> content) avoids redundant reads; `blobCache` (OID+path -> result)
  avoids redundant classification
- Date gaps are filled by carrying forward the previous day's stats with `comments: ["-"]`
- Languages without test heuristics have no prod/test split (LanguageCount.prod/test stay undefined)
