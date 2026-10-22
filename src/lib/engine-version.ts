/**
 * Bump whenever counting rules change (languages, skip lists, attribution) so cached results get a full recompute
 * instead of a roll-on that would mix old and new rules in one chart. Lives apart from `git/pipeline.ts` so the page
 * can read it without bundling isomorphic-git.
 */
export const countingEngineVersion = 1
