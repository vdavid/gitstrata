# Accessibility overview

Guide to accessibility testing and remediation for git strata, targeting WCAG 2.1 Level AA.

## What's in these docs

- **[accessibility-audit.md](accessibility-audit.md)** -- Audit report with compliance score (72/100), critical issues,
  and a prioritized checklist. Start here for a high-level picture.
- **[accessibility-fixes.md](accessibility-fixes.md)** -- Detailed remediation guide with before/after code for each
  fix. Use this when you're ready to implement.

## Critical issues

| Issue                  | Severity | WCAG  | Estimate | Location                                         |
| ---------------------- | -------- | ----- | -------- | ------------------------------------------------ |
| Color contrast failure | Critical | 1.4.3 | 1 hr     | `/src/app.css` lines 45--47, 106--109            |
| Chart has no data alt  | Critical | 1.3.1 | 2 hrs    | `/src/lib/components/ResultsChart.svelte` l. 535 |
| Icon buttons unlabeled | Critical | 1.1.1 | 30 min   | `/src/routes/+page.svelte` lines 491, 493        |

## Where to start

1. Read the [audit](accessibility-audit.md) for context (~5 min)
2. Open [fixes](accessibility-fixes.md) and work through fixes 1--3 (critical)
3. Then fixes 4--10 (high priority)
4. Run the testing checklist at the bottom of the fixes doc

## Files affected

**Critical fixes:**

- `/src/app.css` -- color token updates
- `/src/routes/+page.svelte` -- button labels, progress area
- `/src/lib/components/ResultsChart.svelte` -- data accessibility

**High-priority fixes:**

- `/src/lib/components/ThemeToggle.svelte` -- touch target size
- `/src/lib/components/ResultsTable.svelte` -- sort button labels
- `/src/lib/components/CacheManager.svelte` -- delete button label
- `/src/app.css` -- focus indicators, touch targets

**New component:**

- `/src/lib/components/KeyboardHelp.svelte` (create new)

## Timeline

| Week | Work                                                     |
| ---- | -------------------------------------------------------- |
| 1    | Critical fixes: color tokens, aria-labels, chart alt     |
| 2    | High-priority: touch targets, focus, keyboard help, etc. |
| 3    | Validation and polish: automated + manual testing        |

Total: 17--23 hours.

## Compliance checklist

### Before starting

- [ ] Team has read the audit
- [ ] Dev(s) assigned to fixes
- [ ] Testing environment ready
- [ ] Screen reader installed (VoiceOver, NVDA, or JAWS)

### After critical fixes (week 1)

- [ ] Color contrast verified with WebAIM checker
- [ ] All buttons have aria-labels
- [ ] Chart has data table alternative
- [ ] Basic automated testing passes
- [ ] Manual keyboard navigation works

### After high-priority fixes (week 2)

- [ ] Touch targets are 44x44px minimum
- [ ] Focus indicators visible in all modes
- [ ] Keyboard shortcuts documented
- [ ] Animation respects `prefers-reduced-motion`
- [ ] Table headers properly labeled

### Final validation (week 3)

- [ ] axe-core: zero violations
- [ ] WAVE: no errors
- [ ] Lighthouse: 90+ accessibility score
- [ ] VoiceOver/NVDA: all content accessible
- [ ] Keyboard-only: complete navigation possible
- [ ] High contrast mode: content visible
- [ ] 200% zoom: no horizontal scrolling
- [ ] Motion preferences respected
- [ ] Color blindness: pattern fills working

## Testing tools

**Automated:** axe-core, WAVE, Lighthouse (built into Chrome DevTools)

**Screen readers:** VoiceOver (macOS, built-in), NVDA (Windows, free), JAWS (Windows, commercial)

**Color and contrast:** WebAIM Contrast Checker, Sim Daltonism

## Keeping things accessible

After reaching AA compliance:

1. **Add to CI** -- integrate axe-core into automated tests, keep Svelte a11y warnings enabled
2. **Quarterly reviews** -- run automated + manual testing, update docs as needed
3. **New feature checklist** -- must pass axe-core, support keyboard nav, work with screen readers, meet contrast
   requirements, and respect motion preferences

## Resources

- [WCAG 2.1 quick reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM](https://webaim.org/)
- [Svelte accessibility warnings](https://svelte.dev/docs/accessibility-warnings)

## Status

**Current compliance:** 72% WCAG 2.1 Level AA **Target:** 100% WCAG 2.1 Level AA **Estimated effort:** 17--23 hours over
two to three weeks
