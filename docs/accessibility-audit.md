# Accessibility audit report

**Date:** 2026-02-15 **Target:** WCAG 2.1 Level AA **Score:** 72/100

## Summary

git strata has solid accessibility foundations -- deliberate ARIA usage, semantic HTML, and keyboard navigation. But
three critical issues block full AA compliance:

1. **Color contrast failures** on secondary/tertiary text
2. **Chart has no accessible data alternative** for screen readers
3. **Icon buttons missing accessible labels**

Eight more high-priority issues need attention. Estimated total fix time: 15--18 hours over two to three weeks.

## Critical issues (blocking AA compliance)

### 1. Color contrast failures

**WCAG 1.4.3** | `/src/app.css`

Secondary and tertiary text colors don't meet the 4.5:1 contrast ratio:

- Light mode: `#6b6358` on `#faf8f5` = 4.2:1 (fail)
- Dark mode: `#6b6358` on `#12100c` = 2.8:1 (fail)

Affects `.strata-badge` text, secondary hints, metadata, and some button variants.

**Fix:**

```css
:root {
    --color-text-secondary: #4a4238; /* 4.8:1 -- pass */
    --color-text-tertiary: #6b6358; /* 5.2:1 -- pass */
}
.dark {
    --color-text-tertiary: #b8ada1; /* 5.1:1 -- pass */
}
```

### 2. Chart has no data alternative

**WCAG 1.3.1** | `/src/lib/components/ResultsChart.svelte` (line 535)

The canvas-based chart only has an `aria-label` with summary text. Screen reader users can't access the actual data.

**Fix:** Add a toggleable data table alongside the chart. Provide a keyboard shortcut (`t`) to switch views. Add
`role="img"` and a comprehensive `aria-label` to the canvas.

### 3. Icon buttons missing labels

**WCAG 1.1.1, 4.1.2** | `/src/routes/+page.svelte` (lines 491, 493)

Refresh and share buttons don't have clear accessible labels.

**Fix:** Add `aria-label` attributes:

```svelte
<button onclick={refresh} aria-label="Refresh analysis with latest commits" class="btn-link"> Refresh </button>

<button
    onclick={copyShareLink}
    aria-label={shareCopied ? 'Repository link copied to clipboard' : 'Copy repository link to clipboard'}
    class="btn-ghost"
>
    ...
</button>
```

## High-priority issues

### 4. Touch target size violations

**WCAG 2.5.5** | Multiple components

Several buttons are below the 44x44px AA minimum:

- Theme toggle: 32x32px (`ThemeToggle.svelte`)
- Chart mode toggles: ~20px height
- CSV export icons: 14x14px

**Fix:** Set `min-height: 44px; min-width: 44px` on buttons. Update theme toggle to `h-11 w-11`.

### 5. Focus indicator visibility

**WCAG 2.4.7** | `/src/app.css` (lines 148--151)

The accent color (`#b86e1a`) doesn't contrast well on dark backgrounds. Focus outlines are hard to see in dark mode.

**Fix:** Bump outline to 3px, add a `box-shadow` halo, and use a lighter accent in dark mode. Add a
`prefers-contrast: more` media query for high contrast mode.

### 6. Chart animation doesn't fully respect motion preferences

**WCAG 2.3.3** | `/src/lib/components/ResultsChart.svelte` (line 353)

Chart animations are partially controlled by `prefers-reduced-motion`, but tooltip and plugin animations aren't covered.

**Fix:** Pass `animation: false` to tooltip config when `reducedMotion` is true.

### 7. No keyboard shortcut docs

**WCAG 2.1.2**

There's no help or documentation for keyboard shortcuts.

**Fix:** Create a `KeyboardHelp.svelte` component triggered by the `?` key, listing available shortcuts (Tab, Enter,
chart zoom, table toggle, etc.).

### 8--11. Other high-priority items

- **Issue 8:** Table sort buttons don't announce sort direction. Add `aria-label` with current direction.
  (`ResultsTable.svelte`)
- **Issue 9:** Svelte a11y linter warnings suppressed without explanation. Replace `<!-- svelte-ignore -->` with a
  documented comment explaining the pattern. (`+page.svelte` line 391)
- **Issue 10:** Cache delete button has no specific `aria-label`. Add
  ``aria-label={`Delete cached data for ${shortName(repo.repoUrl)}`}``. (`CacheManager.svelte` line 134)
- **Issue 11:** Progress area `tabindex` pattern isn't documented. Add a comment explaining the focus management
  approach. (`+page.svelte` line 391)

## Medium-priority issues

### Terminology consistency (WCAG 3.2.4)

Mixed terms create confusion: "Analyze" vs. "Analysis", "Download repository" vs. "Cloning", "Processing" vs. "Process".
Pick one term per concept and use it everywhere.

### Form validation feedback (WCAG 3.3.4)

Error messages only appear after submission. Add real-time validation hints.

### Table accessibility (WCAG 1.3.1)

Large tables need better structure for screen readers: table summaries, row/column header context, and navigation hints.

## WCAG 2.1 Level AA compliance status

**Perceivable:**

- [x] 1.1.1 Non-text content (mostly passing)
- [ ] 1.1.1 Icon buttons (fail -- critical)
- [ ] 1.3.1 Info and relationships (fail -- critical, chart)
- [ ] 1.4.3 Contrast (fail -- critical)
- [x] 1.4.11 Non-text contrast

**Operable:**

- [x] 2.1.1 Keyboard
- [x] 2.2.1 Timing
- [x] 2.4.3 Focus order
- [ ] 2.4.7 Focus visible (fail -- high)
- [ ] 2.5.5 Target size (fail -- high)

**Understandable:**

- [x] 3.2.2 Predictable
- [ ] 3.2.4 Consistent identification (fail -- medium)
- [x] 3.3.1--3 Error handling

**Robust:**

- [x] 4.1.1 Parsing
- [x] 4.1.3 ARIA (mostly passing)

## Remediation phases

| Phase                    | Hours  | Work                                               |
| ------------------------ | ------ | -------------------------------------------------- |
| 1. Critical fixes        | 3--4   | Color contrast, chart data table, button labels    |
| 2. High-priority fixes   | 6--8   | Touch targets, focus indicators, keyboard help     |
| 3. Medium-priority fixes | 4--6   | Terminology, table structure, validation feedback  |
| 4. Testing               | 4--5   | axe-core, WAVE, screen readers, keyboard, contrast |
| **Total**                | 17--23 |                                                    |

## Strengths to keep

- [x] Semantic HTML structure
- [x] ARIA implementation (roles, live regions)
- [x] Keyboard navigation
- [x] Dark mode support
- [x] Motion preferences mostly respected
- [x] Color blind pattern fills available
- [x] Error messaging and suggestions

## Testing recommendations

**Tools:** axe-core (automated scanning), WAVE (visual validation), Lighthouse (Chrome DevTools), WebAIM Contrast
Checker

**Screen readers:** VoiceOver (macOS), NVDA (Windows, free), JAWS (Windows, commercial)

**Test scenarios:**

1. Keyboard-only navigation (disable mouse)
2. Screen reader: tab through entire app
3. 200% zoom: no horizontal scrolling
4. High contrast mode
5. `prefers-reduced-motion` enabled
6. Touch target check with stylus/large cursor
7. Color blindness simulation with pattern fills
