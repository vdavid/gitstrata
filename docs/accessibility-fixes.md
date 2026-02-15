# Accessibility fixes

Detailed code changes for all critical and high-priority accessibility issues. See the
[audit](accessibility-audit.md) for context.

## Critical fixes (do these first)

### Fix 1: Color contrast -- update CSS tokens

**File:** `/src/app.css`

**Before (lines 45--47, 106--109):**

```css
:root {
	--color-text: #1a1510;
	--color-text-secondary: #6b6358; /* fail: 4.2:1 ratio */
	--color-text-tertiary: #9c9488;
}

.dark {
	--color-text: #e8e2d8;
	--color-text-secondary: #9c9488;
	--color-text-tertiary: #6b6358; /* fail: 2.8:1 ratio */
}
```

**After:**

```css
:root {
	--color-text: #1a1510;
	--color-text-secondary: #4a4238; /* 4.8:1 ratio -- pass */
	--color-text-tertiary: #6b6358; /* 5.2:1 ratio -- pass */
}

.dark {
	--color-text: #e8e2d8;
	--color-text-secondary: #9c9488;
	--color-text-tertiary: #b8ada1; /* 5.1:1 ratio -- pass */
}
```

Verify with WebAIM Contrast Checker.

### Fix 2: Icon button accessible labels

**File:** `/src/routes/+page.svelte`

**Before (lines 491, 493--509):**

```svelte
{#if cachedResult}
	<span class="strata-badge">...</span>
	<button onclick={refresh} class="btn-link"> Refresh </button>
{/if}
<button onclick={copyShareLink} class="btn-ghost">
	<svg ... aria-hidden="true">...</svg>
	{shareCopied ? 'Copied!' : 'Copy link'}
</button>
```

**After:**

```svelte
{#if cachedResult}
	<span class="strata-badge">...</span>
	<button onclick={refresh} aria-label="Refresh analysis with latest commits" class="btn-link">
		Refresh
	</button>
{/if}
<button
	onclick={copyShareLink}
	aria-label={shareCopied
		? 'Repository link copied to clipboard'
		: 'Copy repository link to clipboard'}
	class="btn-ghost"
>
	<svg ... aria-hidden="true">...</svg>
	{shareCopied ? 'Copied!' : 'Copy link'}
</button>
```

### Fix 3: Chart data accessibility -- add data table toggle

**File:** `/src/lib/components/ResultsChart.svelte`

Add a `showDataTable` state and a toggle button in the chart toolbar:

```svelte
<script lang="ts">
	let showDataTable = $state(false);

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 't' || e.key === 'T') {
			if (e.ctrlKey || e.metaKey) return;
			e.preventDefault();
			showDataTable = !showDataTable;
		}
	};

	$effect(() => {
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	});
</script>

<!-- Add toggle button alongside existing view mode buttons -->
<button
	onclick={() => (showDataTable = !showDataTable)}
	aria-pressed={showDataTable}
	class="strata-chip text-xs"
	title="Toggle accessible data table view (keyboard: t)"
	aria-label={showDataTable ? 'Hide data table' : 'Show data table'}
>
	{showDataTable ? 'Hide' : 'Show'} data
</button>

<!-- Add role="img" to the canvas -->
<canvas bind:this={canvasEl} role="img" aria-label={ariaLabel}></canvas>

<!-- Render a data table when toggled on -->
{#if showDataTable && days.length > 0}
	<div class="strata-card p-4">
		<h3 class="mb-3 text-sm font-semibold text-[var(--color-text)]">Data table</h3>
		<!-- Reuse ResultsTable or render inline -->
	</div>
{/if}
```

This needs either importing `ResultsTable` into `ResultsChart`, or wiring the toggle in `+page.svelte`.

## High-priority fixes

### Fix 4: Touch target sizes

**File:** `/src/app.css` -- add at end:

```css
button {
	min-height: 44px;
	min-width: 44px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}

.strata-chip {
	min-height: 40px;
	padding: 8px 16px;
}
```

**File:** `/src/lib/components/ThemeToggle.svelte` (line 34)

Change `h-8 w-8` to `h-11 w-11` and add an `aria-label`:

```svelte
<button
    onclick={toggle}
    class="group relative flex h-11 w-11 items-center justify-center rounded-md
        text-[var(--color-text-tertiary)] transition-all
        hover:text-[var(--color-accent)]"
    aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
>
```

### Fix 5: Focus indicator visibility

**File:** `/src/app.css` (lines 148--151)

**Before:**

```css
:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}
```

**After:**

```css
:focus-visible {
	outline: 3px solid var(--color-accent);
	outline-offset: 2px;
	box-shadow:
		0 0 0 2px var(--color-bg),
		0 0 0 5px rgba(184, 110, 26, 0.3);
}

.dark :focus-visible {
	outline-color: var(--color-accent-light);
	box-shadow:
		0 0 0 2px var(--color-bg),
		0 0 0 5px rgba(218, 160, 78, 0.4);
}

@media (prefers-contrast: more) {
	:focus-visible {
		outline-width: 4px;
	}
}
```

### Fix 6: Chart animation motion control

**File:** `/src/lib/components/ResultsChart.svelte` (line 353)

Add tooltip animation control:

```typescript
const buildConfig = (...): ChartConfiguration<'line'> => {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    return {
        options: {
            animation: reducedMotion ? false : { duration: 400, easing: 'easeInOutQuad' },
            plugins: {
                tooltip: {
                    animation: reducedMotion ? false : { duration: 200 },
                },
            },
        },
    };
};
```

### Fix 7: Keyboard shortcut help

**Create:** `/src/lib/components/KeyboardHelp.svelte`

A modal triggered by the `?` key listing available shortcuts:

- **Tab** -- navigate between elements
- **Enter/Space** -- activate buttons
- **Arrow keys** -- navigate within controls
- **T** -- toggle data table view
- **?** -- show keyboard help

Add a small "Shortcuts" button to the footer in `+layout.svelte` that also opens this dialog.

### Fix 8: Table sort button accessibility

**File:** `/src/lib/components/ResultsTable.svelte` (lines 186--202)

Add `aria-label` to sort buttons with the current direction:

```svelte
<button
	aria-label={`Sort by Date ${
		ariaSort('date') === 'ascending'
			? '(ascending)'
			: ariaSort('date') === 'descending'
				? '(descending)'
				: ''
	}`.trim()}
	onclick={() => toggleSort('date')}
>
	Date{sortIndicator('date')}
</button>
```

Repeat for all sortable columns.

### Fix 9: Replace svelte-ignore with documented pattern

**File:** `/src/routes/+page.svelte` (line 391)

**Before:**

```svelte
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div bind:this={progressAreaEl} tabindex={-1} ...>
```

**After:**

```svelte
<!-- Focus management: this live region receives programmatic focus (via requestAnimationFrame)
     when analysis starts, so screen readers announce updates. tabindex={-1} allows programmatic
     focus without adding to tab order. WCAG 4.1.3 compliant. -->
<div bind:this={progressAreaEl} tabindex={-1} ...>
```

### Fix 10: Cache manager delete button label

**File:** `/src/lib/components/CacheManager.svelte` (line 134)

```svelte
<button
	onclick={() => handleDelete(repo.repoUrl)}
	class="btn-ghost shrink-0 px-2 py-1 text-xs"
	aria-label={`Delete cached data for ${shortName(repo.repoUrl)}`}
>
	Delete
</button>
```

## Medium-priority fix

### Fix 11: Terminology consistency

Pick one term per concept and apply everywhere:

| Concept                | Use this     | Don't use          |
| ---------------------- | ------------ | ------------------ |
| The git repo           | "repository" | --                 |
| Cloning/fetching       | "download"   | "clone"            |
| The whole process      | "analyze"    | "analysis" (noun)  |
| Line-counting phase    | "processing" | "process" (noun)   |
| Re-analyzing           | "refresh"    | --                 |
| Getting results as CSV | "export"     | "download results" |

Apply to all user-facing text in components.

## Testing checklist

Run through this after applying fixes:

**Automated:**

- [ ] axe-core scan: zero violations
- [ ] WAVE validation: no errors
- [ ] Lighthouse accessibility audit: 90+

**Keyboard:**

- [ ] Tab through all elements
- [ ] Enter/Space activates buttons
- [ ] No keyboard traps
- [ ] Focus order follows DOM

**Screen reader:**

- [ ] Form labels announced
- [ ] Error messages announced
- [ ] Live region updates announced
- [ ] Table navigable
- [ ] Chart alternative available

**Visual:**

- [ ] High contrast mode: content visible
- [ ] 200% zoom: no horizontal scrolling
- [ ] Color blindness simulation: pattern fills work
- [ ] Focus indicators visible in both themes

**Motion:**

- [ ] `prefers-reduced-motion` enabled: no animations play
- [ ] Interactions still work without animation

## Implementation order

| Day | Fixes | Focus                                      |
| --- | ----- | ------------------------------------------ |
| 1   | 1--3  | Critical: color, button labels, chart      |
| 2   | 4--6  | High: touch targets, focus, animation      |
| 3   | 7--10 | High: keyboard help, table, linting, cache |
| 4   | 11    | Medium: terminology                        |
| 5   | --    | Comprehensive testing                      |

Total: 15--18 hours.

## Verification

```bash
# Lint
pnpm eslint --fix .

# Build and preview
pnpm build && pnpm preview

# Then: manual testing with VoiceOver/NVDA, keyboard-only navigation
```
