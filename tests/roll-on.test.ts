import { describe, it, expect, afterEach } from 'vitest'
import git from 'isomorphic-git'
import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { analyzeLocalRepo, rollOnAnalysis, type LocalRepo } from '#lib/git/pipeline.js'
import { countLinesForCommit } from '#lib/git/count.js'
import type { AnalysisResult, ProgressEvent } from '#lib/types.js'

type Files = Record<string, string>

const toTimestamp = (date: string, hour = 12): number =>
    Math.floor(Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`) / 1000)

const lines = (count: number, prefix = 'line'): string =>
    Array.from({ length: count }, (_, i) => `${prefix} ${i}`).join('\n') + '\n'

/** A repo on node fs whose commits are built from in-memory snapshots, so branches and back-dated commits are easy. */
const createRepo = () => {
    const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'roll-on-test-'))
    const fs = nodeFs

    const writeTree = async (files: Files): Promise<string> => {
        const blobs: Array<{ mode: string; path: string; oid: string; type: 'blob' | 'tree' }> = []
        const subdirs = new Map<string, Files>()
        for (const [filePath, content] of Object.entries(files)) {
            const [head, ...rest] = filePath.split('/')
            if (rest.length === 0) {
                const oid = await git.writeBlob({ fs, dir, blob: new TextEncoder().encode(content) })
                blobs.push({ mode: '100644', path: head, oid, type: 'blob' })
            } else {
                const sub = subdirs.get(head) ?? {}
                sub[rest.join('/')] = content
                subdirs.set(head, sub)
            }
        }
        for (const [name, sub] of subdirs) {
            blobs.push({ mode: '040000', path: name, oid: await writeTree(sub), type: 'tree' })
        }
        return git.writeTree({ fs, dir, tree: blobs })
    }

    const commit = async (options: {
        files: Files
        date: string
        hour?: number
        parents: string[]
        author?: string
        message?: string
        updateMain?: boolean
    }): Promise<string> => {
        const author = options.author ?? 'Ann'
        const signature = {
            name: author,
            email: `${author.toLowerCase()}@example.com`,
            timestamp: toTimestamp(options.date, options.hour),
            timezoneOffset: 0,
        }
        return git.commit({
            fs,
            dir,
            message: options.message ?? `${author} on ${options.date}`,
            tree: await writeTree(options.files),
            parent: options.parents,
            author: signature,
            committer: signature,
            ref: 'refs/heads/main',
            noUpdateBranch: options.updateMain === false,
        })
    }

    const init = () => git.init({ fs, dir, defaultBranch: 'main' })
    const cleanup = () => nodeFs.rmSync(dir, { recursive: true, force: true })

    return { fs, dir, init, commit, cleanup }
}

type Repo = ReturnType<typeof createRepo>

const makeLocalRepo = (repo: Repo, headOid: string, events: ProgressEvent[] = []): LocalRepo => ({
    fs: repo.fs,
    dir: repo.dir,
    repoUrl: 'https://example.com/test/repo',
    defaultBranch: 'main',
    headOid,
    signal: new AbortController().signal,
    onProgress: (event) => events.push(event),
})

/** The largest `total` among per-day progress events: how many day entries the run counted. */
const countProcessedDays = (events: ProgressEvent[]): number =>
    Math.max(0, ...events.map((e) => (e.type === 'process' ? e.total : 0)))

const withoutTimestamp = (result: AnalysisResult) => ({ ...result, analyzedAt: '' })

/** H1: three commits on main across 2024-01-01..05. */
const buildBaseHistory = async (repo: Repo) => {
    const base: Files = { 'src/a.ts': lines(3), 'README.md': lines(2, 'doc') }
    const c1 = await repo.commit({ files: base, date: '2024-01-01', parents: [] })
    const c2Files = { ...base, 'src/a.ts': lines(5), 'tools/b.py': lines(4, 'py') }
    const c2 = await repo.commit({ files: c2Files, date: '2024-01-03', parents: [c1], author: 'Bob' })
    const c3Files = { ...c2Files, 'tests/a.test.ts': lines(6, 'test') }
    const c3 = await repo.commit({ files: c3Files, date: '2024-01-05', parents: [c2] })
    return { c1, c2, c3, c2Files, c3Files }
}

describe('rollOnAnalysis', () => {
    let repo: Repo

    afterEach(() => repo.cleanup())

    it('matches a full analysis when a back-dated branch gets merged', async () => {
        repo = createRepo()
        await repo.init()
        const { c2, c3, c2Files, c3Files } = await buildBaseHistory(repo)
        const cached = await analyzeLocalRepo(makeLocalRepo(repo, c3))

        // Feature branch authored on 2024-01-02, before the last cached day, merged later
        const f1 = await repo.commit({
            files: { ...c2Files, 'src/c.go': lines(7, 'go') },
            date: '2024-01-02',
            parents: [c2],
            author: 'Dee',
            updateMain: false,
        })
        const c4Files = { ...c3Files, 'src/a.ts': lines(8) }
        const c4 = await repo.commit({ files: c4Files, date: '2024-01-06', parents: [c3] })
        const mergedFiles = { ...c4Files, 'src/c.go': lines(7, 'go') }
        const merge = await repo.commit({ files: mergedFiles, date: '2024-01-07', parents: [c4, f1] })
        const c5 = await repo.commit({
            files: { ...mergedFiles, 'src/d.ts': lines(2) },
            date: '2024-01-09',
            parents: [merge],
            author: 'Cy',
        })

        const full = await analyzeLocalRepo(makeLocalRepo(repo, c5))
        const events: ProgressEvent[] = []
        const rolled = await rollOnAnalysis(makeLocalRepo(repo, c5, events), cached)

        // The back-dated commit changes 2024-01-02 onwards, so the cached days are no longer a valid prefix
        expect(full.days.slice(0, cached.days.length)).not.toEqual(cached.days)
        expect(withoutTimestamp(rolled)).toEqual(withoutTimestamp(full))
        // Rewound to 2024-01-02, counted 2024-01-02..09
        expect(countProcessedDays(events)).toBe(8)
    })

    it('counts only the new days when commits land after the cache', async () => {
        repo = createRepo()
        await repo.init()
        const { c3, c3Files } = await buildBaseHistory(repo)
        const cached = await analyzeLocalRepo(makeLocalRepo(repo, c3))

        const c4 = await repo.commit({
            files: { ...c3Files, 'src/a.ts': lines(9) },
            date: '2024-01-08',
            parents: [c3],
            author: 'Bob',
        })
        const full = await analyzeLocalRepo(makeLocalRepo(repo, c4))
        const events: ProgressEvent[] = []
        const rolled = await rollOnAnalysis(makeLocalRepo(repo, c4, events), cached)

        expect(withoutTimestamp(rolled)).toEqual(withoutTimestamp(full))
        // 2024-01-06..08: two carried-forward gap days, then the new commit
        expect(countProcessedDays(events)).toBe(3)
    })

    it('returns the cached result when there are no new commits', async () => {
        repo = createRepo()
        await repo.init()
        const { c3 } = await buildBaseHistory(repo)
        const cached = await analyzeLocalRepo(makeLocalRepo(repo, c3))
        const events: ProgressEvent[] = []
        const rolled = await rollOnAnalysis(makeLocalRepo(repo, c3, events), cached)

        expect(withoutTimestamp(rolled)).toEqual(withoutTimestamp(cached))
        expect(countProcessedDays(events)).toBe(0)
    })

    it('recomputes fully when history was rewritten', async () => {
        repo = createRepo()
        await repo.init()
        const { c2, c3, c2Files } = await buildBaseHistory(repo)
        const cached = await analyzeLocalRepo(makeLocalRepo(repo, c3))

        // Force-push: c3 replaced by a different commit on the same day
        const rewritten = await repo.commit({
            files: { ...c2Files, 'tests/a.test.ts': lines(1, 'test') },
            date: '2024-01-05',
            parents: [c2],
            message: 'Rewritten',
        })
        const full = await analyzeLocalRepo(makeLocalRepo(repo, rewritten))
        const events: ProgressEvent[] = []
        const rolled = await rollOnAnalysis(makeLocalRepo(repo, rewritten, events), cached)

        expect(withoutTimestamp(rolled)).toEqual(withoutTimestamp(full))
        expect(countProcessedDays(events)).toBe(full.days.length)
    })

    it('recomputes fully when .mailmap changes', async () => {
        repo = createRepo()
        await repo.init()
        const { c3, c3Files } = await buildBaseHistory(repo)
        const cached = await analyzeLocalRepo(makeLocalRepo(repo, c3))

        const c4 = await repo.commit({
            files: { ...c3Files, '.mailmap': 'Robert <robert@example.com> Bob <bob@example.com>\n' },
            date: '2024-01-08',
            parents: [c3],
        })
        const full = await analyzeLocalRepo(makeLocalRepo(repo, c4))
        const rolled = await rollOnAnalysis(makeLocalRepo(repo, c4), cached)

        // Past days now credit Robert, which only a full recompute produces
        expect(full.days[2].authors).toEqual(['Robert <robert@example.com>'])
        expect(withoutTimestamp(rolled)).toEqual(withoutTimestamp(full))
    })

    it('recomputes fully when the cached result predates the counting engine version', async () => {
        repo = createRepo()
        await repo.init()
        const { c3 } = await buildBaseHistory(repo)
        const cached = await analyzeLocalRepo(makeLocalRepo(repo, c3))
        const legacy = { ...cached, engineVersion: undefined }
        const events: ProgressEvent[] = []
        const rolled = await rollOnAnalysis(makeLocalRepo(repo, c3, events), legacy)

        expect(withoutTimestamp(rolled)).toEqual(withoutTimestamp(cached))
        expect(countProcessedDays(events)).toBe(cached.days.length)
    })
})

describe('C/C++ header classification', () => {
    let repo: Repo

    afterEach(() => repo.cleanup())

    /** `.h` files predate any `.cpp`; a `.cpp` lands on 01-03 and is deleted on 01-05, along with a header edit. */
    const buildHeaderHistory = async (repo: Repo) => {
        const c1Files: Files = { 'src/a.h': lines(3, 'h'), 'src/a.c': lines(2, 'c') }
        const c1 = await repo.commit({ files: c1Files, date: '2024-01-01', parents: [] })
        const c2Files = { ...c1Files, 'src/b.cpp': lines(4, 'cpp') }
        const c2 = await repo.commit({ files: c2Files, date: '2024-01-03', parents: [c1] })
        const base = { ...c1Files, 'src/a.h': lines(3, 'header') }
        const c3 = await repo.commit({ files: base, date: '2024-01-05', parents: [c2] })
        return { c1, c2, c3, base }
    }

    const languagesOn = (result: AnalysisResult, date: string) =>
        Object.fromEntries(
            Object.entries(result.days.find((day) => day.date === date)?.languages ?? {}).map(([id, count]) => [
                id,
                count.total,
            ]),
        )

    it('classifies .h by the tree of each day alone', async () => {
        repo = createRepo()
        await repo.init()
        const { c3 } = await buildHeaderHistory(repo)
        const result = await analyzeLocalRepo(makeLocalRepo(repo, c3))

        expect(languagesOn(result, '2024-01-01')).toEqual({ c: 5 })
        expect(languagesOn(result, '2024-01-02')).toEqual({ c: 5 })
        expect(languagesOn(result, '2024-01-03')).toEqual({ c: 2, cpp: 7 })
        expect(languagesOn(result, '2024-01-04')).toEqual({ c: 2, cpp: 7 })
        expect(languagesOn(result, '2024-01-05')).toEqual({ c: 5 })
        // Velocity counts written lines only: the flips move the `.h` lines between languages without activity
        const day3 = result.days.find((day) => day.date === '2024-01-03')
        const day5 = result.days.find((day) => day.date === '2024-01-05')
        expect([day3?.languageAdded, day3?.languageRemoved]).toEqual([{ cpp: 4 }, {}])
        expect([day5?.languageAdded, day5?.languageRemoved]).toEqual([{}, { cpp: 4 }])
    })

    it('rolls on to the same result as a full run after .cpp files came and went', async () => {
        repo = createRepo()
        await repo.init()
        const { c3, base } = await buildHeaderHistory(repo)
        const cached = await analyzeLocalRepo(makeLocalRepo(repo, c3))

        const c4 = await repo.commit({
            files: { ...base, 'src/a.c': lines(6, 'c') },
            date: '2024-01-07',
            parents: [c3],
        })
        const full = await analyzeLocalRepo(makeLocalRepo(repo, c4))
        const rolled = await rollOnAnalysis(makeLocalRepo(repo, c4), cached)

        expect(languagesOn(full, '2024-01-07')).toEqual({ c: 9 })
        expect(withoutTimestamp(rolled)).toEqual(withoutTimestamp(full))
    })

    it('ignores cached .h decisions made under a different tree', async () => {
        repo = createRepo()
        await repo.init()
        const { c1, c2 } = await buildHeaderHistory(repo)
        const blobCache = new Map()
        const countAt = (commitOid: string) =>
            countLinesForCommit(
                { fs: repo.fs, dir: repo.dir, commitOid, blobCache, contentCache: new Map() },
                '2024-01-01',
                [],
            )

        expect((await countAt(c1)).languages.c?.total).toBe(5)
        // Same `.h` blob and path, now next to a `.cpp`: the shared cache must not answer "C"
        expect((await countAt(c2)).languages.cpp?.total).toBe(7)
    })
})
