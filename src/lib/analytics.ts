// Typed wrapper around the Umami tracker loaded in `+layout.svelte` (served first-party under `/u/*`).
// Never send tokens, keys, or anything else secret as event data.

import { parseRepoUrl } from './url'

type AnalysisSource = 'fresh' | 'refresh' | 'auto-roll-on'

type EventToPropsMap = {
    'analysis-start': { repo: string; source: AnalysisSource }
    'analysis-done': {
        repo: string
        mode: 'full' | 'roll-on'
        seconds: number
        days: number
        commits: number
        uploaded: boolean
    }
    'analysis-error': { repo: string; kind: string }
    'analysis-cancel': { repo: string }
    'cache-hit': { repo: string; source: 'local' | 'shared' }
    'shared-adopt': { repo: string }
    'size-gate': { repo: string }
    'write-key-adopted': undefined
}

export type AnalyticsEvent = keyof EventToPropsMap

type UmamiWindow = { umami?: { track: (name: string, data?: Record<string, unknown>) => void } }

/** Send an Umami event. No-op when the tracker is absent (no analytics ID, adblocker, SSR); never throws. */
export const trackEvent = <E extends AnalyticsEvent>(
    ...[name, data]: EventToPropsMap[E] extends undefined ? [E] : [E, EventToPropsMap[E]]
): void => {
    try {
        if (typeof window === 'undefined') return
        ;(window as unknown as UmamiWindow).umami?.track(name, data)
    } catch {
        // Analytics is best-effort
    }
}

/** `owner/repo` for GitHub, `host/owner/repo` for other forges, `''` when unparsable. */
export const repoLabel = (repoUrl: string): string => {
    try {
        const { host, owner, repo } = parseRepoUrl(repoUrl)
        return host === 'github.com' ? `${owner}/${repo}` : `${host}/${owner}/${repo}`
    } catch {
        return ''
    }
}
