# Health, contributors, delta view, and era markers

Add five features that turn gitstrata from a chart renderer into a repo evaluation tool. All features derive from git
data already being cloned — no external APIs needed.

## Current state

- The pipeline walks the full commit history, counting lines per file per day, classified by language and prod/test.
- Author names/emails are available in the commit objects (`commit.commit.author`) but not extracted — only the
  timestamp is used today.
- The chart is a stacked area chart (Chart.js) with three view modes: All, Prod vs test, Languages only.
- Five summary cards exist: Total lines, Prod/test split, Average growth, Age, Peak day.
- `DayStats` stores `date`, `total`, `languages`, `comments`. No author data.

## Feature 1: Extract contributor data

### Goal

Extract author information during the commit history walk so downstream features (contributor card, delta view by
contributor) can use it.

### Design

**Extend `DailyCommit`** in `src/lib/git/history.ts`:

```ts
export interface DailyCommit {
    date: string
    hash: string
    messages: string[]
    authors: string[] // NEW — deduplicated "Name <email>" strings for this day
}
```

In `getCommitsByDate`, collect `commit.commit.author.name` and `commit.commit.author.email` and store as
`"Name <email>"` in the `authors` array per day. Deduplicate within each day (a person may commit multiple times on the
same day).

**Extend `DayStats`** in `src/lib/types.ts`:

```ts
export interface DayStats {
    date: string
    total: number
    languages: Record<string, LanguageCount>
    comments: string[]
    authors: string[] // NEW — unique author identifiers for this day
}
```

**Extend `AnalysisResult`**:

```ts
export interface AnalysisResult {
    // ... existing fields ...
    totalContributors: number // NEW — distinct authors across all commits
}
```

Compute `totalContributors` at the end of analysis by collecting all unique authors across all `DayStats`. Use a
`Set<string>` on the `"Name <email>"` strings.

**Cache compatibility**: Existing cached results won't have `authors` or `totalContributors`. Handle gracefully:
`authors` defaults to `[]`, `totalContributors` defaults to `0` (the card can show "Unknown" or be hidden).

**Gap-filled days**: Days with no commits (carried forward from previous day) get `authors: []`.

### What changes where

- `src/lib/git/history.ts` — Add `authors` to `DailyCommit`, populate in `getCommitsByDate`
- `src/lib/types.ts` — Add `authors` to `DayStats`, `totalContributors` to `AnalysisResult`
- `src/lib/worker/analyzer.worker.ts` — Pass authors through from `DailyCommit` to `DayStats` in `processDays`, compute
  `totalContributors` before returning result
- `src/lib/cache.ts` — No changes needed (stores full `AnalysisResult` as-is)

## Feature 2: Contributors summary card

### Goal

Show contributor count and concentration as a sixth summary card, answering "is this a one-person project or a team
effort?"

### Design

**New card: "Contributors"** added to `ResultsSummary.svelte`.

Display:

- Primary number: total contributor count (for example, "47")
- Secondary line: concentration metric — "Top 2: 83% of commits"

Concentration is computed client-side from the `authors` arrays across all `DayStats`:

1. Count total commit-days per unique author (a day where they appear in `authors`)
2. Sort descending
3. Show what percentage the top 2 authors account for

If `totalContributors` is 0 or missing (old cached data), show "--" like other cards do for missing data.

**Layout**: The summary grid currently shows 5 cards (`lg:grid-cols-5`). With 6 cards, use `lg:grid-cols-3` (two rows of
three) which works well at all breakpoints. Alternatively, keep `lg:grid-cols-5` and let the sixth card wrap — either
approach works. Pick whichever looks cleaner.

### What changes where

- `src/lib/components/ResultsSummary.svelte` — Add Contributors card, add contributor concentration computation, adjust
  grid if needed

## Feature 3: Delta / derivative view

### Goal

Add a chart mode that shows lines added/removed per day (the derivative of the cumulative chart), answering "how alive
is this project?" and "what's my velocity?"

### Design

**New view mode** added to the existing toggle group in `ResultsChart.svelte`:

```ts
type ViewMode = 'all' | 'prod-vs-test' | 'languages-only' | 'delta'
```

The toggle group gets a fourth button: "Delta".

**When "Delta" is selected:**

- Chart type stays `'line'` but switches from stacked area to a regular (non-stacked) line chart or bar chart.
- Y-axis shows lines changed (positive = net additions, negative = net removals).
- Data: for each day `i`, compute `days[i].total - days[i-1].total`. First day uses its total as-is.
- Show one dataset: "Net lines changed" — a single line/bar showing daily delta.
- Smoothing: apply a 7-day rolling average to reduce noise. Show both the raw daily values (faint, thin) and the
  smoothed line (bold, primary color). This makes trends visible without hiding spikes.
- The Y-axis should allow negative values (repos can shrink).
- Tooltip: show the date, raw delta, and smoothed delta.
- Color: use `--color-accent` for positive values and `--color-error` for negative values (or a single neutral color for
  the smoothed line — pick whichever is cleaner).

**Interaction with other toggles**: The "Delta" mode is mutually exclusive with the other three modes (All, Prod vs
test, Languages only). When Delta is selected, the others are deselected. When any other mode is selected, Delta is
deselected. The pattern fills toggle is hidden in delta mode since there is only one dataset.

**Summary cards**: Keep showing the same cards regardless of view mode. The cards always reflect cumulative data.

### What changes where

- `src/lib/components/ResultsChart.svelte` — Add 'delta' to `ViewMode`, add toggle button, add `buildDeltaDatasets`
  function, conditionally use it in the render effect, adjust chart config (no stacking, allow negative y-axis)

## Feature 4: Era markers on the chart

### Goal

Draw labeled vertical lines on the chart at industry-level AI milestones. These are the "geological era boundaries" that
make every chart a conversation piece.

### Design

**Three markers**, hardcoded:

| Date       | Label       | Short label |
| ---------- | ----------- | ----------- |
| 2022-06-21 | Copilot GA  | Copilot     |
| 2025-01-01 | Agentic era | Agentic     |
| 2025-11-24 | Opus 4.5    | Opus 4.5    |

Only show markers that fall within the repo's date range (between first and last commit). If a repo started in 2024,
don't show the Copilot marker.

**Rendering**: Implement as a Chart.js plugin (similar pattern to the existing `crosshairPlugin`). For each visible
marker:

- Draw a vertical dashed line at the marker's x position (use `--color-foreground-tertiary` with reduced opacity).
- Draw a small label at the top of the chart, rotated or horizontal, showing the short label and year.
- Use a subtle style — these are contextual, not primary data. Think of them as "watermarks."

**Toggle**: Add a small toggle (checkbox or chip) labeled "Show era markers" near the existing view mode toggles.
Default: on. Persist preference to `localStorage`.

**Accessibility**: Each marker line includes a title/aria-label like "Copilot general availability, June 2022".

### What changes where

- `src/lib/components/ResultsChart.svelte` — Add era markers plugin, add toggle chip, filter markers by date range

## Feature 5: Last meaningful update

### Goal

Surface when the repo last had a meaningful code change, not just a docs edit. This serves the "is this alive?" question
better than raw "last commit" date.

### Design

**Definition of "meaningful"**: A day where the net line change (delta) in non-docs, non-config languages exceeds a
threshold. Specifically:

- Exclude languages with `isMeta: true` or `id === 'docs'` or `id === 'config'` from the delta calculation for that day.
- If the remaining delta (absolute value) is > 10 lines, consider it meaningful.
- This is a heuristic — it doesn't need to be perfect, just better than "last commit."

**Where to show it**: In the existing "Age" card. Below the "started" line, add a second line:

- "Last active: Jan 2026" (if different from the last commit date by more than 30 days)
- If the last meaningful update matches the last commit date (within 30 days), don't show it (it would be redundant).

This keeps the UI clean — the extra line only appears when it adds information.

**Computation**: Done in `ResultsSummary.svelte` (client-side, from `days` array). Walk backward through days, compute
non-meta delta for each day, find the last one exceeding the threshold.

### What changes where

- `src/lib/components/ResultsSummary.svelte` — Add last-meaningful-update computation and conditional display in the Age
  card

## Tasks

### Milestone 1: Contributor data extraction

- [ ] Extend `DailyCommit` with `authors` field in `history.ts`
- [ ] Populate `authors` from `commit.commit.author` in `getCommitsByDate`
- [ ] Extend `DayStats` with `authors` field in `types.ts`
- [ ] Extend `AnalysisResult` with `totalContributors` in `types.ts`
- [ ] Pass authors through in `analyzer.worker.ts` (`processDays` and result assembly)
- [ ] Handle missing `authors`/`totalContributors` gracefully for old cached results
- [ ] Add unit tests for author extraction and deduplication
- [ ] Run `./scripts/check.sh`

### Milestone 2: Contributors summary card

- [ ] Add Contributors card to `ResultsSummary.svelte` showing count and concentration
- [ ] Compute contributor concentration (top 2 authors' share of commit-days)
- [ ] Adjust grid layout for 6 cards
- [ ] Handle missing data (old cache) gracefully
- [ ] Verify dark/light mode, responsive layout, accessibility
- [ ] Run `./scripts/check.sh`

### Milestone 3: Delta / derivative view

- [ ] Add `'delta'` to `ViewMode` type and add toggle button
- [ ] Implement `buildDeltaDatasets` (raw daily delta + 7-day rolling average)
- [ ] Adjust chart config for delta mode (no stacking, negative y-axis)
- [ ] Update tooltip for delta mode (show raw + smoothed values)
- [ ] Hide pattern fills toggle in delta mode
- [ ] Verify zoom/pan still works in delta mode
- [ ] Run `./scripts/check.sh`

### Milestone 4: Era markers

- [ ] Define era markers array (Copilot, Agentic, Opus 4.5) with dates and labels
- [ ] Implement Chart.js plugin for vertical dashed lines with labels
- [ ] Filter markers to repo's date range
- [ ] Add toggle chip with `localStorage` persistence
- [ ] Verify markers render correctly in all view modes including delta
- [ ] Add aria-labels for accessibility
- [ ] Run `./scripts/check.sh`

### Milestone 5: Last meaningful update

- [ ] Add last-meaningful-update logic to `ResultsSummary.svelte`
- [ ] Filter out meta/docs/config languages from delta calculation
- [ ] Show "Last active" line in Age card only when it adds information
- [ ] Verify with repos that have recent docs-only commits
- [ ] Run `./scripts/check.sh`

### Milestone 6: Final polish

- [ ] Manual end-to-end test: analyze a repo and verify all five features work together
- [ ] Update `src/lib/CLAUDE.md` with new fields and features
- [ ] Update `spec.md` if needed (summary cards section, chart view modes)
- [ ] Run full `./scripts/check.sh`
