# Contributor breakdown chart + toolbar redesign

## Context

git strata shows lines of code over time broken down by language. This spec adds a "Contributors" view showing the same
timeline broken down by who wrote the code. This requires:

1. Processing **all commits** (not just one per day) to attribute line deltas to individual authors
2. Parsing `.mailmap` files for author identity deduplication
3. Redesigning the chart toolbar to separate **breakdown dimension** (Languages/Contributors) from **measurement mode**
   (cumulative/velocity)

## Files to modify

| File                                     | Change                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/lib/types.ts`                       | Add `contributors?` to `DayStats`, add `CommitEntry` interface                             |
| `src/lib/git/mailmap.ts`                 | **New file** — `.mailmap` parser + author normalizer                                       |
| `src/lib/git/history.ts`                 | Add `CommitEntry` type, extend `DailyCommit` with `commits[]`, add `normalizeAuthor` param |
| `src/lib/worker/analyzer.worker.ts`      | Multi-commit processing loop, wire mailmap, track `authorLineTotals`                       |
| `src/lib/components/ResultsChart.svelte` | Two-level toolbar, contributor datasets, velocity toggle                                   |
| `src/app.css`                            | Add `.strata-tab` underline tab style                                                      |
| `src/lib/CLAUDE.md`                      | Update architecture docs                                                                   |
| `tests/mailmap.test.ts`                  | **New file** — unit tests for mailmap parser                                               |

## Step 1: Type changes

### `src/lib/types.ts`

Add optional `contributors` field to `DayStats`:

```typescript
export interface DayStats {
    date: string
    total: number
    languages: Record<string, LanguageCount>
    comments: string[]
    authors: string[]
    /** Per-author cumulative line count at end of day. Undefined for old cached results. */
    contributors?: Record<string, number>
}
```

No changes to `AnalysisResult` — `totalContributors` already exists.

### `src/lib/git/history.ts`

Add `CommitEntry` interface and extend `DailyCommit`:

```typescript
/** A single commit with its metadata */
export interface CommitEntry {
    hash: string
    author: string // "Name <email>" (mailmap-normalized)
    message: string
    timestamp: number // unix seconds, for ordering within a day
}

export interface DailyCommit {
    date: string
    hash: string // latest commit hash (kept for backward compat)
    messages: string[]
    authors: string[]
    commits: CommitEntry[] // ALL commits this day, sorted oldest-first
}
```

## Step 2: `.mailmap` parser (new file)

### `src/lib/git/mailmap.ts`

Lightweight parser (~80 lines) supporting the 4 `.mailmap` forms:

1. `Proper Name <commit@email>` — replace name only
2. `<proper@email> <commit@email>` — replace email only
3. `Proper Name <proper@email> <commit@email>` — replace both by email match
4. `Proper Name <proper@email> Commit Name <commit@email>` — replace both by name+email match

Exports:

- `parseMailmap(content: string): MailmapEntry[]`
- `createMailmapLookup(entries: MailmapEntry[]): (name: string, email: string) => string`
- `readMailmapFromRepo(fs, dir, headRef, gitCache?): Promise<MailmapEntry[]>` — reads `.mailmap` from repo root tree via
  `git.readTree` + `git.readBlob`; returns `[]` if not found

## Step 3: History changes

### `src/lib/git/history.ts` — `getCommitsByDate()`

Add optional `normalizeAuthor` parameter. Extend the loop to collect ALL commits per day:

- Currently: only stores `hash` (latest commit OID) and `messages` per day
- Change: also build a `commits: CommitEntry[]` array per day with every commit's hash, author, message, and timestamp
- After collection, sort each day's `commits` array by timestamp ascending (oldest first)
- Apply `normalizeAuthor(name, email)` when building the author string (falls back to raw `"Name <email>"` when no
  mailmap)

The `hash` field keeps pointing to the latest commit OID (unchanged behavior for callers that don't use `commits`).

## Step 4: Multi-commit processing

### `src/lib/worker/analyzer.worker.ts` — `processDays()`

Add `authorLineTotals: Map<string, number>` parameter that persists across all days.

New inner loop per day (when `commit` exists):

```
prevTotal = (dayIndex === 0) ? 0 : days[dayIndex-1].total

FOR EACH ce IN commit.commits (oldest first):
    IF prevCommitOid:
        dayStats = countLinesForCommitIncremental(ce.hash, prevCommitOid, ...)
    ELSE:
        dayStats = countLinesForCommit(ce.hash, ...)

    delta = dayStats.total - prevTotal
    authorLineTotals[ce.author] += delta
    prevTotal = dayStats.total

    contentCache.clear()
    prevCommitOid = ce.hash

// dayStats from last iteration = latest commit state (correct for language chart)
dayStats.authors = commit.authors
dayStats.contributors = snapshot of authorLineTotals
```

Key invariant: after processing all intra-day commits, `fileStateMap` reflects the latest commit's tree — identical to
the current one-commit-per-day result. The language breakdown is unaffected.

**Gap days**: carry forward `contributors` from previous day (same as `languages`).

### `analyze()` changes

After clone, before `getCommitsByDate`:

1. Call `readMailmapFromRepo()` to get mailmap entries
2. Create `normalizeAuthor` lookup function
3. Pass to `getCommitsByDate({ ..., normalizeAuthor })`
4. Create `authorLineTotals = new Map<string, number>()`
5. Pass to `processDays({ ..., authorLineTotals })`

### `analyzeIncremental()` changes

Same as `analyze()` but also bootstrap `authorLineTotals` from the last cached day:

```typescript
const authorLineTotals = new Map<string, number>()
const lastCachedDay = cachedResult.days.at(-1)
if (lastCachedDay?.contributors) {
    for (const [author, lines] of Object.entries(lastCachedDay.contributors)) {
        authorLineTotals.set(author, lines)
    }
}
```

If old cached results lack `contributors`, the map starts empty — contributor data will only cover the incremental
segment. A full re-analysis gives complete contributor data.

## Step 5: Chart toolbar redesign

### `src/app.css` — new `.strata-tab` class

```css
.strata-tab {
    display: inline-flex;
    align-items: center;
    padding: 12px 16px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--color-foreground-tertiary);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-out-expo);
}

.strata-tab:hover {
    color: var(--color-foreground-secondary);
}
.strata-tab[aria-selected='true'] {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
}
.strata-tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
```

### `src/lib/components/ResultsChart.svelte` — toolbar + contributor datasets

**New state model** (replaces flat `ViewMode`):

```typescript
type PrimaryTab = 'languages' | 'contributors'
type LanguageSubMode = 'all' | 'prod-vs-test' | 'languages-only'
type ContributorSubMode = 'all-contributors' | 'top-10'

let primaryTab = $state<PrimaryTab>('languages')
let languageSubMode = $state<LanguageSubMode>('all')
let contributorSubMode = $state<ContributorSubMode>('all-contributors')
let velocityEnabled = $state(false)
```

**Toolbar layout** (two rows inside `strata-card`):

Row 1 (primary tabs + velocity toggle):

```
[Languages]  [Contributors]                          [⇅ Velocity]
─────────────────────────────────────────────────────────────────
```

Row 2 (sub-mode chips + utility toggles):

```
[All] [Prod vs test] [Languages only]    [Era markers] [Pattern fills] Reset zoom
```

When Contributors tab is active, row 2 chips become:

```
[All contributors] [Top 10]              [Era markers]  Reset zoom
```

(Pattern fills hidden when contributors tab or velocity is active — no stacked areas to pattern.)

**`buildContributorDatasets()`** — new function:

- `computeVisibleContributors(days, mode)`: returns `{ shown: string[], other: boolean }`
    - `'all-contributors'` mode: show contributors with >= 5% of total at latest point
    - `'top-10'` mode: show top 10 by line count
- `contributorDisplayName(authorStr)`: extracts "Name" from "Name <email>"
- Dataset construction: same stacked area pattern as language datasets, using the same mineral color palette by rank

**Updated render effect**: branches on `primaryTab` and `velocityEnabled`:

```
if velocityEnabled → buildVelocityDatasets(days)
else if primaryTab === 'contributors' → buildContributorDatasets(...)
else → buildDatasets(days, ..., languageSubMode)
```

Velocity works identically in both tabs — it shows total repo velocity, not per-contributor or per-language velocity.
Same daily delta + 7-day rolling average.

**`buildDatasets()` refactor**: rename `mode` param from `ViewMode` to `LanguageSubMode`, remove the `'velocity'` case
(now handled by the outer branch).

## Step 6: Backward compatibility

- `DayStats.contributors` is optional — old cached results deserialize fine
- Contributors tab disabled when `days[last].contributors === undefined`
- `DailyCommit.commits` is a new field — `fillDateGaps` passes `DailyCommit` through unchanged, so the field naturally
  propagates
- `analyzeIncremental` bootstraps `authorLineTotals` from cache; if cache lacks contributor data, it starts empty (only
  incremental segment gets contributor data)

## Step 7: Tests

### `tests/mailmap.test.ts` (new)

- All 4 `.mailmap` forms parse correctly
- Comments and blank lines are skipped
- Case-insensitive email matching
- Most-specific form wins (form 4 > form 3 > form 1)
- `readMailmapFromRepo` returns `[]` when no `.mailmap` exists

### Manual integration testing

- Analyze a multi-contributor repo (e.g., `sveltejs/svelte`)
- Verify contributor chart shows stacked areas
- Verify toolbar: tab switching, velocity toggle, sub-mode chips
- Verify old cached results load with Contributors tab disabled
- Verify dark mode styling of new `.strata-tab` elements
- Verify incremental refresh with contributor data

## Step 8: Update docs

Update `src/lib/CLAUDE.md`:

- Document `DayStats.contributors` field
- Document `CommitEntry` and `DailyCommit.commits`
- Document `git/mailmap.ts` module
- Document multi-commit processing in `analyzer.worker.ts`
- Document two-level chart toolbar in `ResultsChart.svelte`

## Implementation order

1. Types + mailmap parser (pure additions, no breakage)
2. History changes (extend `DailyCommit`, add `normalizeAuthor`)
3. Processing pipeline (multi-commit loop, `authorLineTotals`)
4. CSS for underline tabs
5. Chart toolbar + contributor datasets
6. Tests
7. Docs
