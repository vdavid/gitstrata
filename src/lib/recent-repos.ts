/**
 * "Recent favorite" ranking for the repos this browser has analyzed, a frecency score with exponential decay:
 * each visit adds 1, and the whole score halves every `halfLifeDays`. Visits within `visitDedupeMs` of the previous
 * one don't count, so reopening a repo 1,000 times in an afternoon weighs like one visit.
 */

interface VisitRecord {
    score: number
    /** Epoch ms of the last counted visit (the time `score` is valid at) */
    lastVisit: number
}

export type VisitLog = Record<string, VisitRecord>

const halfLifeDays = 3
const visitDedupeMs = 60 * 60 * 1000
const storageKey = 'gitstrata-repo-visits'

const decay = (score: number, fromMs: number, toMs: number): number =>
    score * 0.5 ** (Math.max(0, toMs - fromMs) / (halfLifeDays * 24 * 60 * 60 * 1000))

export const recordVisit = (log: VisitLog, repoUrl: string, nowMs: number): VisitLog => {
    const previous = log[repoUrl] as VisitRecord | undefined
    if (previous && nowMs - previous.lastVisit < visitDedupeMs) return log
    const score = (previous ? decay(previous.score, previous.lastVisit, nowMs) : 0) + 1
    return { ...log, [repoUrl]: { score, lastVisit: nowMs } }
}

/**
 * Order cached repos by current score, best first. Repos cached before visits were tracked count as one visit at
 * their last access. Repos in the log that are no longer cached are left out.
 */
export const rankRecentRepos = (
    cachedRepoUrls: string[],
    repoUrlToLastAccessedMap: Record<string, string>,
    log: VisitLog,
    nowMs: number,
): string[] => {
    const scoreOf = (repoUrl: string): number => {
        const record = log[repoUrl] as VisitRecord | undefined
        if (record) return decay(record.score, record.lastVisit, nowMs)
        const lastAccessed = Date.parse(repoUrlToLastAccessedMap[repoUrl] ?? '')
        return Number.isNaN(lastAccessed) ? 0 : decay(1, lastAccessed, nowMs)
    }
    return cachedRepoUrls
        .map((repoUrl) => ({ repoUrl, score: scoreOf(repoUrl) }))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.repoUrl)
}

export const loadVisitLog = (): VisitLog => {
    try {
        const raw = localStorage.getItem(storageKey)
        return raw ? (JSON.parse(raw) as VisitLog) : {}
    } catch {
        return {}
    }
}

export const saveVisit = (repoUrl: string): void => {
    try {
        localStorage.setItem(storageKey, JSON.stringify(recordVisit(loadVisitLog(), repoUrl, Date.now())))
    } catch {
        // Storage unavailable (private mode, quota): ranking falls back to last access
    }
}
