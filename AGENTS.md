# git strata

Git strata is a browser-native LoC counter — a free SaaS that visualizes how any public Git repository's codebase grows
over time, broken down by language and prod/test. All git operations and line counting happen client-side in Web
Workers. The only server component is a minimal CORS proxy that forwards bytes.

Running:

- Dev server: `pnpm dev`
- Prod build: `pnpm build`

## File structure

This is a single SvelteKit app (not a monorepo). Tech: SvelteKit + Svelte 5, TypeScript strict, Tailwind CSS v4, static
adapter. Package manager: pnpm.

Core structure:

- `src/` - SvelteKit frontend
    - `routes/` - Single-page app (one route)
    - `lib/components/` - Svelte components (RepoInput, PipelineProgress, ResultsChart, etc.)
    - `lib/worker/` - Web Worker entry point and Comlink-wrapped API
    - `lib/git/` - Clone, history, and line counting logic (runs in the worker)
    - `lib/languages.ts` - Language registry: extensions, test patterns, inline detectors
    - `lib/cache.ts` - IndexedDB results cache
    - `lib/url.ts` - Repo URL parsing and normalization
    - `lib/types.ts` - Shared type definitions
    - `app.css` - Tailwind v4 import + CSS custom properties
- `cors-proxy/` - Cloudflare Worker (Hono) — adds CORS headers, forwards bytes, zero compute
- `scripts/` - Go-based check runner (`scripts/check/`) and reference LoC counter (read-only)
- `static/` - Static assets
- `tests/` - Unit tests (Vitest) and end-to-end tests (Playwright)
- `docs/` - Dev docs
    - `specs/` - Feature plans and specs
    - `style-guide.md` - Writing and code style rules
- `spec.md` - Product spec

## Testing and checking

Run the smallest set of checks possible for efficiency while maintaining confidence.

- Running a single test: `pnpm vitest run -t "<test_name>"`
- Run all: `./scripts/check.sh`
- Running specific checks:
  `./scripts/check.sh --check {prettier,eslint,knip,svelte-check,vitest,pnpm-audit,gofmt,go-vet,staticcheck,go-tests}`
- CI mode (no auto-fixing): `./scripts/check.sh --ci`
- See also: `./scripts/check.sh --help`

Frontend (SvelteKit): `prettier` → `eslint` → `knip` → `svelte-check` → `vitest` | `pnpm-audit` Scripts (Go): `gofmt` →
`go-vet` → `go-tests` | `gofmt` → `staticcheck`

## TypeScript

- Only functional components and modules. No classes.
- Don't use `any` type. ESLint will error.
- Prefer functional programming (map, reduce, some, forEach) and pure functions wherever it makes sense.
- Use `const` for everything, unless it makes the code unnecessarily verbose.
- Start function names with a verb, unless unidiomatic in the specific case.
- Use `camelCase` for variable and constant names, including module-level constants.
- Put constants closest to where they're used. If a constant is only used in one function, put it in that function.
- For maps, try to name them like `somethingToSomethingElseMap`. That avoids unnecessary comments.
- Keep interfaces minimal: only export what you must export.

## CSS

- Tailwind CSS v4. Use CSS custom properties for chart colors, light/dark tokens.
- Always think about accessibility when designing, and dark+light modes.
- Use `px` by default but can use `rem` if it's more descriptive.

## Design guidelines

- Always make features extremely user-friendly.
- Always apply radical transparency: make the internals of what's happening available. Hide the details from the surface
  so the main UI isn't cluttered.
- For longer processes: 1. show a progress indicator (an animation), 2. a progress bar and counter if we know the end
  state (for example, how many files we're loading), and 3. a time estimate if we have a guess how long it'll take.
- Always keep accessibility in mind. Features should be available to people with impaired vision, hearing, and cognitive
  disabilities.
- All actions longer than, say, one second should be immediately cancelable, canceling not just the UI but any
  background processes as well, to avoid wasting the user's resources.

## Things to avoid

- Don't add JSDoc that repeats types or obvious function names
- Don't ignore linter warnings (fix them or justify with a comment)
- Don't add dependencies without checking license compatibility (all deps must be MIT or similarly permissive)

## Git

Max 50 char title, a few bullets of body if needed. No co-author.

## Planning

- When getting oriented, consider the docs: `docs` folder and `CLAUDE.md` files in each directory.
- When coming up with a plan, save it to `docs/specs/{feature}-plan.md` (we clean out old plans periodically, git
  history remembers them).
- Also create an accompanying task list that fully covers but doesn't duplicate the plan on a high level. If all items
  on the task list are honestly marked as done, the plan is fully implemented in great quality. Tasks should be
  one-liners, grouped by milestones. Include docs, testing, and running all necessary checks.

## Development

- Always tick off tasks as they're done when using a task list.
- When testing, consider using Vitest and Playwright, whatever is needed to feel confident about the development. Do
  this per milestone. Don't go overboard with unit tests. Test exactly so that you feel confident.
- **Keep docs alive**: When modifying a feature directory that has a `CLAUDE.md`, check if the doc still matches the
  code. Update it if your changes affect architecture, key decisions, or gotchas. Don't update for trivial changes. If
  there's no `CLAUDE.md` file yet, but you want to capture high-level info about a module or feature, create one. Make
  it faster for the next person or agent to get oriented.

Always do a last round of checks before finishing up:

1. Looking back at this work, do you think this will be convenient to maintain later?
2. Will this lead to great UX for the end user, with sufficient transparency into the work that's happening?
3. Discuss with the user anything that's not great, or fix if straightforward then go to point 1.

## Useful references

- [Svelte 5 docs](https://svelte.dev/docs/svelte/overview)
- [SvelteKit docs](https://svelte.dev/docs/kit/introduction)
- [Tailwind CSS v4 docs](https://tailwindcss.com/docs)
- [isomorphic-git docs](https://isomorphic-git.org/docs/en/guide)
- [Chart.js docs](https://www.chartjs.org/docs/latest/)
- [Style guide](docs/style-guide.md) — keep this in mind! Especially "sentence case" for titles and labels!
- [Visual language](docs/visual-language.md) — color tokens, typography, surfaces, component patterns

Happy coding!
