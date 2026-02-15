# Visual language

git strata's design system, documented from the codebase. The metaphor is **geological stratigraphy** — layers of
rock, mineral colors, warm stone surfaces, and subtle grain texture. The interface should feel like reading a
well-formatted field notebook: warm, precise, and honest.

## Color system

All colors live as CSS custom properties on `:root` (light) and `.dark` (dark). No raw hex values in components.

### UI tokens

| Token                     | Light                 | Dark                     | Role                                   |
|---------------------------|-----------------------|--------------------------|----------------------------------------|
| `--color-bg`              | `#faf8f5`             | `#12100c`                | Page background                        |
| `--color-bg-secondary`    | `#f2efe9`             | `#1e1a14`                | Table headers, secondary areas         |
| `--color-bg-tertiary`     | `#e8e4dc`             | `#2c261e`                | Progress track, inset surfaces         |
| `--color-text`            | `#1a1510`             | `#e8e2d8`                | Primary text                           |
| `--color-text-secondary`  | `#4a4238`             | `#9c9488`                | Supporting text, table body            |
| `--color-text-tertiary`   | `#6b6358`             | `#b8ada1`                | Metadata, labels, timestamps           |
| `--color-border`          | `#ddd8cf`             | `#2c261e`                | Standard borders                       |
| `--color-border-strong`   | `#c4bdb2`             | `#3e362c`                | Hover borders, emphasis                |
| `--color-accent`          | `#b86e1a`             | `#daa04e`                | Primary action (sandstone amber)       |
| `--color-accent-hover`    | `#a05e12`             | `#e8b46a`                | Accent hover state                     |
| `--color-accent-light`    | `#f5e8d4`             | `#2c2010`                | Accent background tint                 |
| `--color-accent-muted`    | `#dab87e`             | `#8b6e3e`                | Decorative accent (logo strata layers) |
| `--color-success`         | `#4a8c5c`             | `#6ab87e`                | Completed states (forest serpentine)   |
| `--color-error`           | `#b83a2a`             | `#da5a4a`                | Error states (red clay)                |
| `--color-error-light`     | `#fdf0ee`             | `#2a1410`                | Error background tint                  |
| `--color-warning`         | `#9e8b3e`             | `#c4b05a`                | Warning states (pyrite gold)           |
| `--color-surface-raised`  | `#ffffff`             | `#1a1610`                | Card surfaces                          |
| `--color-surface-overlay` | `rgba(26,21,16,0.03)` | `rgba(232,226,216,0.02)` | Subtle card overlay                    |

### Chart palette

12 named mineral/geological colors plus an "other" bucket. Each has a main variant (production code) and a tint
(test layers or dark-mode fill).

| Index | Name              | Light main | Dark main |
|-------|-------------------|------------|-----------|
| 1     | Deep ocean blue   | `#2e6b9e`  | `#5a9ece` |
| 2     | Forest serpentine | `#4a8c5c`  | `#6ab87e` |
| 3     | Sandstone amber   | `#c2781e`  | `#daa04e` |
| 4     | Amethyst          | `#8b4e8b`  | `#b07eb0` |
| 5     | Red clay          | `#b85433`  | `#da7a5a` |
| 6     | Malachite teal    | `#2e8b8b`  | `#5abebe` |
| 7     | Pyrite gold       | `#9e8b3e`  | `#c4b05a` |
| 8     | Rhodonite         | `#a64560`  | `#d07088` |
| 9     | Slate blue        | `#4a5e8b`  | `#7088c0` |
| 10    | Jade              | `#3e8b6e`  | `#5abe90` |
| 11    | Charoite          | `#7b5ea6`  | `#a088cc` |
| 12    | Azurite           | `#2e7090`  | `#5a9ec0` |
| other | Limestone         | `#b0a898`  | `#6b6358` |

Chart colors are accessed via `--chart-N` (main) and `--chart-N-tint` (test/secondary fill). Languages
with < 5% share at the latest data point are bucketed into "other."

## Typography

Two typefaces, no others.

| Token         | Family  | Usage                                                          |
|---------------|---------|----------------------------------------------------------------|
| `--font-sans` | DM Sans | Headlines, body text, buttons, labels                          |
| `--font-mono` | DM Mono | Data values, inputs, metadata, table cells, badges, timestamps |

### Type scale (observed in components)

| Role                | Family | Size          | Weight | Letter-spacing | Extra                                |
|---------------------|--------|---------------|--------|----------------|--------------------------------------|
| Hero headline       | Sans   | 3xl--5xl      | Bold   | `-0.025em`     | Responsive via `sm:`/`lg:`           |
| Body / subtitle     | Sans   | sm--base      | 400    | Default        | `leading-relaxed`                    |
| Card section label  | Mono   | 0.625rem      | 400    | `0.08em`       | `text-transform: uppercase`          |
| Card metric value   | Mono   | 1.125rem      | 500    | `-0.01em`      |                                      |
| Table header        | Mono   | 0.6875rem     | 400    | `0.06em`       | `text-transform: uppercase`          |
| Table cell          | Mono   | 0.8125rem     | 400    | Default        | `font-variant-numeric: tabular-nums` |
| Detail line / meta  | Mono   | 0.6875rem     | 400    | `0.02em`       |                                      |
| Button (primary)    | Sans   | 0.875rem      | 500    | `0.01em`       |                                      |
| Button (ghost)      | Sans   | 0.8125rem     | 400    | Default        |                                      |
| Input               | Mono   | sm (0.875rem) | 400    | `0.01em`       |                                      |
| Badge               | Mono   | 0.75rem       | 400    | `0.02em`       |                                      |
| Pipeline step label | Sans   | 0.75rem       | 500    | `0.01em`       |                                      |

## Motion

| Token               | Value                           | Usage                       |
|---------------------|---------------------------------|-----------------------------|
| `--ease-out-expo`   | `cubic-bezier(0.16, 1, 0.3, 1)` | All transitions             |
| `--duration-fast`   | `150ms`                         | Hover, focus, color changes |
| `--duration-normal` | `250ms`                         | Theme switch                |
| `--duration-slow`   | `500ms`                         | Fade-in, stagger            |

### Animations

- **`strata-pulse`**: Opacity 1 → 0.4 → 1 over 2s. Used on active pipeline dots.
- **`strata-fade-in`**: Translate Y 8px → 0 + opacity 0 → 1 over `--duration-slow`. Entry animation for cards.
- **`strata-stagger`**: Children of `.strata-stagger` get `strata-fade-in` with 60ms delay increments.
- **`strata-lines-shift`**: Background position shift for hero decorative lines.

All animations respect `prefers-reduced-motion: reduce` (set to 0.01ms duration).

## Surfaces and depth

**Strategy: borders only.** No drop shadows. Depth is communicated through border + subtle background shifts.

| Surface        | Class / token            | Background                   | Border                           |
|----------------|--------------------------|------------------------------|----------------------------------|
| Page           | `--color-bg`             | Warm off-white / deep cavern | None                             |
| Card           | `.strata-card`           | `--color-surface-raised`     | 1px `--color-border`, 8px radius |
| Card overlay   | `.strata-card::after`    | `--color-surface-overlay`    | Inherited from card              |
| Dialog         | `<dialog>`               | `--color-surface-raised`     | 1px `--color-border`, 8px radius |
| Input          | `<input>`                | `--color-surface-raised`     | 1px `--color-border`, 6px radius |
| Progress track | `.strata-progress-track` | `--color-bg-tertiary`        | 1px `--color-border`, 3px radius |

A subtle **noise texture** (`body::before`) gives all surfaces a stone grain feel at very low opacity
(2.5% light, 4% dark).

### Decorative elements

- **Strata line** (`.strata-line`): 1px horizontal gradient that fades at both ends. Used as header/footer
  separator.
- **Hero lines** (`.strata-hero-lines`): Repeating horizontal lines with radial mask, shifted with a slow
  animation. Background texture for the hero section.

## Component patterns

### Buttons

Three variants, all with `cursor: pointer` and `transition: all var(--duration-fast)`.

| Variant | Class          | Background       | Border                 | Text                     | Hover behavior               |
|---------|----------------|------------------|------------------------|--------------------------|------------------------------|
| Primary | `.btn-primary` | `--color-accent` | Transparent            | White                    | Darker bg, translateY(-1px)  |
| Ghost   | `.btn-ghost`   | Transparent      | 1px `--color-border`   | `--color-text-secondary` | Bg tertiary, stronger border |
| Link    | `.btn-link`    | None             | Bottom 1px transparent | `--color-accent`         | Bottom border appears        |

All buttons have `:disabled` state at 50% opacity with `cursor: not-allowed`.

### Badge

`.strata-badge`: Pill-shaped (`border-radius: 999px`), mono font, 0.75rem, with icon + text. Used for status
indicators like "Last analyzed: 2025-01-15."

### Chip toggle

`.strata-chip`: Pill-shaped toggle buttons for chart view modes. `aria-pressed="true"` state fills with accent
color and white text.

### Cards

`.strata-card`: The primary container. White/raised surface, 1px border, 8px radius, with a subtle overlay
`::after` pseudo-element. Used for: summary stat cards (compact: `px-4 py-3.5`), progress panel (`p-5`),
chart container, data table wrapper, error alerts, cache manager.

Error cards override border color: `border-[var(--color-error)]`.

### Tables

`.strata-table`: Full-width, collapsed borders. Mono font throughout. Uppercase headers with wide tracking.
Hover rows get `--color-surface-overlay`. Wrapped in `.strata-scroll` for horizontal overflow with styled
scrollbar.

### Inputs

Mono font, `--color-surface-raised` background, 6px radius. Border changes on focus (accent) and error (red).
Placeholder uses `--color-text-tertiary`.

### Progress bar

`.strata-progress-track` + `.strata-progress-fill`: 6px tall, rounded. Fill has a subtle white gradient overlay
(`::after`). Width transitions smoothly at 300ms. Accent color during clone, success color during analysis.

### Pipeline steps

Horizontal stepper with dots + labels + connector lines. Three states:

- **Done**: Success green dot with checkmark SVG, success label
- **Active**: Accent dot with pulse animation, primary text label
- **Pending**: Empty dot with border, tertiary text label

Connector lines: 24px wide, 1.5px, standard border color (done = success green).

### Dialogs

Native `<dialog>` with `backdrop:bg-black/50`. Same surface treatment as cards. Used for keyboard shortcuts.

### Icons

Inline SVGs throughout — no icon library. Consistent style: 16px default, `stroke-width: 1.5--2`,
`stroke-linecap: round`, `stroke-linejoin: round`. Always `aria-hidden="true"` with adjacent text labels.

## Layout

- **Max width**: `max-w-5xl` (default), `2xl:max-w-7xl` (wide screens)
- **Page padding**: `px-4 sm:px-6`
- **Section spacing**: `space-y-8 sm:space-y-10`
- **Card padding**: `p-4` to `p-5` depending on content density
- **Summary grid**: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` with `gap-3`
- **Chart height**: Responsive: `h-64 sm:h-80 md:h-96 lg:h-[28rem] xl:h-[32rem]`

## Accessibility

- Skip-to-content link in layout header
- `aria-label` on all interactive regions and icon-only buttons
- `aria-pressed` on toggle buttons (chips)
- `aria-sort` on sortable table headers
- `aria-live="polite"` on progress area for screen reader updates
- `aria-invalid` + `aria-describedby` on form inputs with errors
- `role="alert"` on error messages
- Focus ring: 3px accent outline + 2px bg gap + accent glow shadow
- High contrast mode: 4px outline width
- `prefers-reduced-motion`: all animations disabled
- Pattern fills toggle on chart for color blindness support
- Keyboard shortcut dialog (press `?`)
- 44px minimum touch target on interactive elements

## Writing style

See [style-guide.md](./style-guide.md) for full writing conventions. Key points for UI text:

- Sentence case for all titles and labels
- Friendly, informal, concise
- Active voice, no jargon
- Start UI actions with a verb
- Error messages: positive, actionable, specific
