import git, { type FsClient } from 'isomorphic-git'
import type { AnalysisResult, DayStats, ProgressEvent } from '../types'
import { collectAncestorOids, fillDateGaps, getCommitsByDate, type DailyCommit } from './history'
import {
    computeCommitContribution,
    countLinesForCommit,
    countLinesForCommitIncremental,
    LruMap,
    type FileState,
    type TreeLanguageState,
} from './count'
import { createMailmapLookup, readMailmapFromRepo, readMailmapOid } from './mailmap'
import { countingEngineVersion } from '../engine-version'

type ProgressCallback = (event: ProgressEvent) => void

type BlobResult = { lines: number; testLines: number; languageId: string | undefined }
type TreeEntry = { path: string; oid: string; type: string }

/** Everything that carries over from one processed commit to the next. */
interface ProcessingState {
    prevCommitOid: string | undefined
    prevDay: DayStats | undefined
    fileStateMap: Map<string, FileState>
    treeLanguage: TreeLanguageState
    authorLineTotals: Map<string, number>
}

interface Caches {
    blobCache: Map<string, BlobResult>
    contentCache: Map<string, string>
    treeCache: Map<string, TreeEntry[]>
    gitCache: object
}

const createCaches = (gitCache: object): Caches => ({
    blobCache: new LruMap<string, BlobResult>(100_000),
    contentCache: new Map<string, string>(), // Cleared per commit, no LRU needed
    treeCache: new LruMap<string, TreeEntry[]>(10_000),
    gitCache,
})

const createEmptyState = (): ProcessingState => ({
    prevCommitOid: undefined,
    prevDay: undefined,
    fileStateMap: new Map(),
    treeLanguage: { cppSourceCount: 0 },
    authorLineTotals: new Map(),
})

/** The commit whose tree represents the day's end state (commits are sorted oldest-first). */
const getLastCommitOfDay = (commit: DailyCommit): string => commit.commits.at(-1)?.hash ?? commit.hash

const processDays = async (params: {
    fs: FsClient
    dir: string
    dayEntries: Array<{ date: string; commit: DailyCommit | undefined }>
    caches: Caches
    state: ProcessingState
    signal: AbortSignal
    onProgress: ProgressCallback
}): Promise<DayStats[]> => {
    const { fs, dir, dayEntries, caches, state, signal, onProgress } = params
    const { blobCache, contentCache, treeCache, gitCache } = caches
    const { fileStateMap, treeLanguage, authorLineTotals } = state
    const totalDays = dayEntries.length
    const days: DayStats[] = []

    const countCommit = async (commitOid: string, date: string, messages: string[]): Promise<DayStats> => {
        const dayStats = state.prevCommitOid
            ? await countLinesForCommitIncremental(
                  {
                      fs,
                      dir,
                      commitOid,
                      prevCommitOid: state.prevCommitOid,
                      blobCache,
                      contentCache,
                      treeCache,
                      gitCache,
                      signal,
                  },
                  fileStateMap,
                  treeLanguage,
                  date,
                  messages,
              )
            : await countLinesForCommit(
                  {
                      fs,
                      dir,
                      commitOid,
                      blobCache,
                      contentCache,
                      fileStateMap,
                      treeLanguage,
                      treeCache,
                      gitCache,
                      signal,
                  },
                  date,
                  messages,
              )
        contentCache.clear()
        state.prevCommitOid = commitOid
        return dayStats
    }

    for (let i = 0; i < dayEntries.length; i++) {
        if (signal.aborted) throw new Error('Cancelled')

        const { date, commit } = dayEntries[i]

        onProgress({ type: 'process', current: i + 1, total: totalDays, date })

        let dayStats: DayStats | undefined

        if (commit) {
            if (commit.commits && commit.commits.length > 0) {
                // Multi-commit path: iterate each commit to attribute line deltas to authors
                const dayLanguageAdded: Record<string, number> = {}
                const dayLanguageRemoved: Record<string, number> = {}
                const dayContributorAdded: Record<string, number> = {}
                const dayContributorRemoved: Record<string, number> = {}

                for (const ce of commit.commits) {
                    dayStats = await countCommit(ce.hash, date, commit.messages)

                    // Parent-based attribution; merge commits (>1 parent) are skipped
                    if (ce.parentOids.length <= 1) {
                        const parentOid = ce.parentOids.length === 1 ? ce.parentOids[0] : undefined
                        const contribution = await computeCommitContribution({
                            fs,
                            dir,
                            commitOid: ce.hash,
                            parentOid,
                            blobCache,
                            contentCache,
                            treeCache,
                            // `treeLanguage` describes this commit's tree: it was just counted
                            treeHasCppSources: treeLanguage.cppSourceCount > 0,
                            gitCache,
                        })

                        authorLineTotals.set(
                            ce.author,
                            (authorLineTotals.get(ce.author) ?? 0) + contribution.totalDelta,
                        )

                        for (const [lang, value] of Object.entries(contribution.languageAdded)) {
                            dayLanguageAdded[lang] = (dayLanguageAdded[lang] ?? 0) + value
                        }
                        for (const [lang, value] of Object.entries(contribution.languageRemoved)) {
                            dayLanguageRemoved[lang] = (dayLanguageRemoved[lang] ?? 0) + value
                        }
                        dayContributorAdded[ce.author] = (dayContributorAdded[ce.author] ?? 0) + contribution.totalAdded
                        dayContributorRemoved[ce.author] =
                            (dayContributorRemoved[ce.author] ?? 0) + contribution.totalRemoved
                        contentCache.clear()
                    }
                }

                // dayStats from the last iteration = the day's end state (correct for the language chart)
                if (dayStats) {
                    dayStats.authors = commit.authors
                    dayStats.contributors = Object.fromEntries(authorLineTotals)
                    dayStats.languageAdded = dayLanguageAdded
                    dayStats.languageRemoved = dayLanguageRemoved
                    dayStats.contributorAdded = dayContributorAdded
                    dayStats.contributorRemoved = dayContributorRemoved
                }
            } else {
                // Backward compat: data without a commits array — single-commit behavior
                dayStats = await countCommit(commit.hash, date, commit.messages)
                dayStats.authors = commit.authors
            }
            if (dayStats) state.prevDay = dayStats
        } else if (state.prevDay) {
            // Gap day: carry forward previous stats
            const prevDay = state.prevDay
            dayStats = {
                date,
                total: prevDay.total,
                languages: Object.fromEntries(Object.entries(prevDay.languages).map(([k, v]) => [k, { ...v }])),
                comments: ['-'],
                authors: [],
                contributors: prevDay.contributors ? { ...prevDay.contributors } : undefined,
                languageAdded: {},
                languageRemoved: {},
                contributorAdded: {},
                contributorRemoved: {},
            }
        }

        if (!dayStats) continue
        days.push(dayStats)
        onProgress({ type: 'day-result', day: dayStats })
    }

    return days
}

/** A cloned repo on a git-compatible fs, plus where to report progress. */
export interface LocalRepo {
    fs: FsClient
    dir: string
    repoUrl: string
    defaultBranch: string
    /** OID of the default branch tip to analyze */
    headOid: string
    signal: AbortSignal
    onProgress: ProgressCallback
}

const loadHistory = async (repo: LocalRepo, gitCache: object): Promise<DailyCommit[]> => {
    const { fs, dir, headOid, signal, onProgress } = repo
    onProgress({ type: 'process', current: 0, total: 0, date: 'Loading history...' })
    const normalizeAuthor = createMailmapLookup(await readMailmapFromRepo(fs, dir, headOid, gitCache))
    const dailyCommits = await getCommitsByDate({
        fs,
        dir,
        ref: headOid,
        gitCache,
        signal,
        normalizeAuthor,
        onProgress: (processed) => {
            onProgress({
                type: 'process',
                current: 0,
                total: 0,
                date: `Loading history... (${processed.toLocaleString()} commits)`,
            })
        },
    })
    if (dailyCommits.length === 0) throw new Error('No commits found in repository')
    return dailyCommits
}

const buildResult = (
    repo: LocalRepo,
    days: DayStats[],
    mailmapOid: string,
    repoSizeBytes: number | undefined,
): AnalysisResult => {
    const lastDay = days[days.length - 1]
    const detectedLanguages = Object.entries(lastDay.languages)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([id]) => id)
    const allAuthors = new Set(days.flatMap((day) => day.authors ?? []))

    return {
        repoUrl: repo.repoUrl,
        defaultBranch: repo.defaultBranch,
        headCommit: repo.headOid,
        analyzedAt: new Date().toISOString(),
        detectedLanguages,
        days,
        totalContributors: allAuthors.size,
        mailmapOid,
        engineVersion: countingEngineVersion,
        ...(repoSizeBytes !== undefined ? { repoSizeBytes } : {}),
    }
}

/** Analyze the full history of an already cloned repo. */
export const analyzeLocalRepo = async (repo: LocalRepo, repoSizeBytes?: number): Promise<AnalysisResult> => {
    const gitCache = {}
    const mailmapOid = await readMailmapOid(repo.fs, repo.dir, repo.headOid, gitCache)
    const dailyCommits = await loadHistory(repo, gitCache)
    const days = await processDays({
        fs: repo.fs,
        dir: repo.dir,
        dayEntries: fillDateGaps(dailyCommits),
        caches: createCaches(gitCache),
        state: createEmptyState(),
        signal: repo.signal,
        onProgress: repo.onProgress,
    })
    return buildResult(repo, days, mailmapOid, repoSizeBytes)
}

const isAncestor = async (fs: FsClient, dir: string, oid: string, ancestor: string): Promise<boolean> => {
    try {
        return await git.isDescendent({ fs, dir, oid, ancestor, depth: -1 })
    } catch {
        // Missing commit objects (for example, a force push dropped them) mean we can't trust the cached chain
        return false
    }
}

/**
 * Roll a cached result forward to `repo.headOid`, recounting only the days new commits can affect.
 *
 * New commits are bucketed by AUTHOR date, so a freshly merged branch can land on days before the last cached day.
 * We rewind to the earliest day holding a new commit, seed the counting state from the day before it, and recount
 * from there. The result equals a full analysis of the new history. Falls back to a full analysis of the local clone
 * when the cached result can't be trusted as a prefix: rewritten history, a changed `.mailmap`, or a different
 * counting engine version.
 */
export const rollOnAnalysis = async (repo: LocalRepo, cachedResult: AnalysisResult): Promise<AnalysisResult> => {
    const { fs, dir, headOid, signal, onProgress } = repo
    const repoSizeBytes = cachedResult.repoSizeBytes
    const recomputeFully = () => analyzeLocalRepo(repo, repoSizeBytes)

    if (cachedResult.engineVersion !== countingEngineVersion) return recomputeFully()
    if (headOid === cachedResult.headCommit) return { ...cachedResult, analyzedAt: new Date().toISOString() }
    if (!(await isAncestor(fs, dir, headOid, cachedResult.headCommit))) return recomputeFully()

    const gitCache = {}
    const mailmapOid = await readMailmapOid(fs, dir, headOid, gitCache)
    if (cachedResult.mailmapOid === undefined || cachedResult.mailmapOid !== mailmapOid) return recomputeFully()

    const dailyCommits = await loadHistory(repo, gitCache)
    const cachedAncestors = await collectAncestorOids({ fs, dir, ref: cachedResult.headCommit, gitCache, signal })
    const firstAffectedIndex = dailyCommits.findIndex((day) =>
        day.commits.some((commit) => !cachedAncestors.has(commit.hash)),
    )
    if (firstAffectedIndex === -1) return { ...cachedResult, headCommit: headOid, analyzedAt: new Date().toISOString() }
    // No earlier day to seed from: everything is affected anyway
    if (firstAffectedIndex === 0) return recomputeFully()

    // Days up to the seed hold only old commits, so they match the cached run. The gap days between the seed and the
    // first new commit get recounted (carried forward) along with everything after.
    const seedCommit = dailyCommits[firstAffectedIndex - 1]
    const seedDay = cachedResult.days.find((day) => day.date === seedCommit.date)
    if (!seedDay?.contributors) return recomputeFully()

    // Rebuild the per-file state at the end of the seed day with one full tree walk
    const caches = createCaches(gitCache)
    const state = createEmptyState()
    const seedCommitOid = getLastCommitOfDay(seedCommit)
    await countLinesForCommit(
        {
            fs,
            dir,
            commitOid: seedCommitOid,
            blobCache: caches.blobCache,
            contentCache: caches.contentCache,
            fileStateMap: state.fileStateMap,
            treeLanguage: state.treeLanguage,
            treeCache: caches.treeCache,
            gitCache,
            signal,
        },
        seedCommit.date,
        [],
    )
    caches.contentCache.clear()
    state.prevCommitOid = seedCommitOid
    state.prevDay = seedDay
    for (const [author, lines] of Object.entries(seedDay.contributors)) state.authorLineTotals.set(author, lines)

    const newDays = await processDays({
        fs,
        dir,
        dayEntries: fillDateGaps(dailyCommits).filter((entry) => entry.date > seedCommit.date),
        caches,
        state,
        signal,
        onProgress,
    })
    const keptDays = cachedResult.days.filter((day) => day.date <= seedCommit.date)
    return buildResult(repo, [...keptDays, ...newDays], mailmapOid, repoSizeBytes)
}
