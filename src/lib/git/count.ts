import git, { type FsClient } from 'isomorphic-git'
import type { LanguageDefinition } from '../types'
import type { DayStats, LanguageCount } from '../types'
import { defaultTestDirPatterns, getLanguages, isInTestDir, isTestFile, resolveHeaderLanguage } from '../languages'

/**
 * Map with LRU eviction — entries beyond maxSize are evicted oldest-first.
 * Extends Map so callers that expect a Map work transparently.
 * Note: stored values must not be `undefined` (used as a miss sentinel in `get`).
 */
export class LruMap<K, V> extends Map<K, V> {
    private readonly maxSize: number

    constructor(maxSize: number) {
        super()
        this.maxSize = maxSize
    }

    override get(key: K): V | undefined {
        const val = super.get(key)
        if (val !== undefined) {
            // Move to end (most recently used)
            super.delete(key)
            super.set(key, val)
        }
        return val
    }

    override set(key: K, value: V): this {
        if (super.has(key)) {
            super.delete(key)
        } else if (this.size >= this.maxSize) {
            const oldest = this.keys().next().value
            if (oldest !== undefined) super.delete(oldest)
        }
        super.set(key, value)
        return this
    }
}

const createLimiter = (limit: number) => {
    const queue: (() => void)[] = []
    let active = 0

    return <T>(fn: () => Promise<T>): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const run = () => {
                active++
                fn()
                    .then(resolve, reject)
                    .finally(() => {
                        active--
                        const next = queue.shift()
                        if (next) next()
                    })
            }
            if (active < limit) run()
            else queue.push(run)
        })
    }
}

/** Skip patterns for filenames/extensions that should not be counted (ported from Go) */
const skipPatterns: readonly string[] = [
    // Lock/generated files
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'Cargo.lock',
    'go.sum',
    'Gemfile.lock',
    'Pipfile.lock',
    'poetry.lock',
    'uv.lock',
    'pdm.lock',
    'composer.lock',
    'pubspec.lock',
    'Podfile.lock',
    'mix.lock',
    'flake.lock',
    'packages.lock.json',
    'paket.lock',
    'conan.lock',
    'gradle.lockfile',
    'npm-shrinkwrap.json',
    'Package.resolved',
    // Minified output
    '*.min.js',
    '*.min.css',
    '*.min.mjs',
    // Source maps
    '*.js.map',
    '*.css.map',
    '*.mjs.map',
    // Protobuf codegen
    '*.pb.go',
    '*.pb.cc',
    '*.pb.h',
    '*.pb.swift',
    '*_pb2.py',
    '*_pb2_grpc.py',
    // .NET codegen
    '*.Designer.cs',
    '*.g.cs',
    '*.g.i.cs',
    // Dart codegen
    '*.g.dart',
    '*.freezed.dart',
    // Binary extensions
    '*.png',
    '*.jpg',
    '*.jpeg',
    '*.gif',
    '*.bmp',
    '*.ico',
    '*.icns',
    '*.woff',
    '*.woff2',
    '*.ttf',
    '*.eot',
    '*.otf',
    '*.lottie',
    '*.zip',
    '*.tar',
    '*.gz',
    '*.bz2',
    '*.xz',
    '*.7z',
    '*.rar',
    '*.pdf',
    '*.exe',
    '*.dll',
    '*.so',
    '*.dylib',
    '*.wasm',
    '*.mp3',
    '*.mp4',
    '*.wav',
    '*.ogg',
    '*.webm',
    '*.webp',
    '*.svg',
    '*.avif',
]

/** Vendored/generated directories to skip entirely during tree walks. */
const skipDirs = new Set(['vendor', 'node_modules', 'Pods', 'bower_components', '__pycache__'])

export const shouldSkipDir = (dirName: string): boolean => skipDirs.has(dirName)

export const shouldSkip = (filename: string): boolean => {
    const base = filename.split('/').pop() ?? filename
    for (const pattern of skipPatterns) {
        if (pattern.startsWith('*')) {
            if (base.endsWith(pattern.slice(1))) return true
        } else {
            if (base === pattern) return true
        }
    }
    return false
}

const isBinary = (content: Uint8Array): boolean => {
    const limit = Math.min(content.length, 8000)
    for (let i = 0; i < limit; i++) {
        if (content[i] === 0) return true
    }
    return false
}

/** Count newline bytes (0x0A) directly from raw bytes — encoding-independent. */
const countLinesFromBytes = (bytes: Uint8Array): number => {
    if (bytes.length === 0) return 0
    let lines = 0
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0x0a) lines++
    }
    if (bytes[bytes.length - 1] !== 0x0a) lines++
    return lines
}

export const countLines = (content: string): number => {
    if (content.length === 0) return 0
    let lines = 0
    for (let i = 0; i < content.length; i++) {
        if (content[i] === '\n') lines++
    }
    // Add one if content doesn't end with newline
    if (content[content.length - 1] !== '\n') lines++
    return lines
}

const getExtension = (path: string): string => {
    const base = path.split('/').pop() ?? path
    const dotIdx = base.lastIndexOf('.')
    if (dotIdx <= 0) return ''
    return base.slice(dotIdx)
}

const getBasename = (path: string): string => {
    return path.split('/').pop() ?? path
}

interface BlobCacheEntry {
    lines: number
    testLines: number
    languageId: string | undefined
}

export interface FileState {
    oid: string
    languageId: string | undefined
    lines: number
    testLines: number
}

const makeBlobCacheKey = (oid: string, filePath: string): string => {
    return `${oid}\0${filePath}`
}

interface FileEntry {
    path: string
    oid: string
}

interface TreeEntry {
    path: string // filename (NOT full path)
    oid: string
    type: string // 'blob' | 'tree' | 'commit'
}

const readTreeCached = async (
    fs: FsClient,
    dir: string,
    treeOid: string,
    treeCache: Map<string, TreeEntry[]>,
    gitCache?: object,
): Promise<TreeEntry[]> => {
    const cached = treeCache.get(treeOid)
    if (cached) return cached
    const result = await git.readTree({ fs, dir, oid: treeOid, cache: gitCache })
    const entries = result.tree.map((e) => ({ path: e.path, oid: e.oid, type: e.type }))
    treeCache.set(treeOid, entries)
    return entries
}

const listFilesAtCommitCached = async (options: {
    fs: FsClient
    dir: string
    commitOid: string
    treeCache: Map<string, TreeEntry[]>
    gitCache?: object
}): Promise<FileEntry[]> => {
    const { fs, dir, commitOid, treeCache, gitCache } = options
    const commit = await git.readCommit({ fs, dir, oid: commitOid, cache: gitCache })
    const rootTreeOid = commit.commit.tree

    const files: FileEntry[] = []

    const walkTree = async (treeOid: string, basePath: string) => {
        const entries = await readTreeCached(fs, dir, treeOid, treeCache, gitCache)
        for (const entry of entries) {
            const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
            if (entry.type === 'blob') {
                files.push({ path: fullPath, oid: entry.oid })
            } else if (entry.type === 'tree') {
                if (!shouldSkipDir(entry.path)) {
                    await walkTree(entry.oid, fullPath)
                }
            }
        }
    }

    await walkTree(rootTreeOid, '')
    return files
}

interface CountOptions {
    fs: FsClient
    dir: string
    commitOid: string
    /** Blob result cache (shared across days for dedup) */
    blobCache: Map<string, BlobCacheEntry>
    /** Raw blob content cache by OID (shared across days) */
    contentCache: Map<string, string>
    signal?: AbortSignal
    /** If provided, populated with per-file state for incremental diffing */
    fileStateMap?: Map<string, FileState>
    /** If provided, updated with all file extensions seen */
    allExtensions?: Set<string>
    /** Tree object cache: treeOid -> entries (shared across commits for massive speedup) */
    treeCache?: Map<string, TreeEntry[]>
    /** isomorphic-git object cache — pass the same object to all git calls for in-memory caching */
    gitCache?: object
}

const buildLangsWithTestHeuristics = (): Set<string> => {
    const noSplitIds = new Set(
        getLanguages()
            .filter((l) => l.noTestSplit)
            .map((l) => l.id),
    )
    const result = new Set<string>()
    result.add('other')
    for (const lang of getLanguages()) {
        if (!noSplitIds.has(lang.id)) {
            result.add(lang.id)
        }
    }
    return result
}

const langsWithTestHeuristics = buildLangsWithTestHeuristics()

const computeDayStatsFromFileState = (
    fileStateMap: Map<string, FileState>,
    date: string,
    messages: string[],
): DayStats => {
    const languages: Record<string, LanguageCount> = {}
    let total = 0

    for (const [, state] of fileStateMap) {
        if (!state.languageId) continue
        if (state.lines === 0) continue

        const langId = state.languageId
        const hasSplit = langsWithTestHeuristics.has(langId)
        const existing = languages[langId]

        if (hasSplit) {
            const prod = state.lines - state.testLines
            const test = state.testLines
            const lineTotal = prod + test
            if (existing) {
                existing.total += lineTotal
                if (existing.prod !== undefined) existing.prod += prod
                if (existing.test !== undefined) existing.test += test
            } else {
                languages[langId] = { total: lineTotal, prod, test }
            }
            total += lineTotal
        } else {
            if (existing) {
                existing.total += state.lines
            } else {
                languages[langId] = { total: state.lines }
            }
            total += state.lines
        }
    }

    return { date, total, languages, comments: messages, authors: [] }
}

/** Full tree walk; uses blob dedup caches to avoid redundant reads. */
export const countLinesForCommit = async (
    options: CountOptions,
    date: string,
    messages: string[],
): Promise<DayStats> => {
    const { fs, dir, commitOid, blobCache, contentCache, signal, fileStateMap, allExtensions, treeCache, gitCache } =
        options

    const effectiveTreeCache = treeCache ?? new Map<string, TreeEntry[]>()
    const files = await listFilesAtCommitCached({
        fs,
        dir,
        commitOid,
        treeCache: effectiveTreeCache,
        gitCache,
    })

    if (signal?.aborted) {
        throw new Error('Cancelled')
    }

    // Collect all extensions to resolve .h ambiguity
    const localExtensions = new Set<string>()
    for (const file of files) {
        const ext = getExtension(file.path).toLowerCase()
        localExtensions.add(ext)
        if (allExtensions) allExtensions.add(ext)
    }
    const extensionMap = resolveHeaderLanguage(allExtensions ?? localExtensions)

    // Process all files in parallel with concurrency limit
    const limit = createLimiter(8)
    const fileResults = await Promise.all(
        files.map((file) => {
            if (signal?.aborted) throw new Error('Cancelled')
            return limit(() =>
                processFile(file.path, file.oid, fs, dir, blobCache, contentCache, extensionMap, gitCache),
            )
        }),
    )

    // Aggregate results sequentially
    const languages: Record<string, LanguageCount> = {}
    let total = 0

    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const state = fileResults[i]

        if (fileStateMap) {
            fileStateMap.set(file.path, state)
        }

        if (!state.languageId || state.lines === 0) continue

        const langId = state.languageId
        const hasSplit = langsWithTestHeuristics.has(langId)

        if (hasSplit) {
            const prod = state.lines - state.testLines
            const test = state.testLines
            const lineTotal = prod + test
            const existing = languages[langId]
            if (existing) {
                existing.total += lineTotal
                if (existing.prod !== undefined) existing.prod += prod
                if (existing.test !== undefined) existing.test += test
            } else {
                languages[langId] = { total: lineTotal, prod, test }
            }
            total += lineTotal
        } else {
            const existing = languages[langId]
            if (existing) {
                existing.total += state.lines
            } else {
                languages[langId] = { total: state.lines }
            }
            total += state.lines
        }
    }

    return { date, total, languages, comments: messages, authors: [] }
}

const processFile = async (
    filePath: string,
    oid: string,
    fs: FsClient,
    dir: string,
    blobCache: Map<string, BlobCacheEntry>,
    contentCache: Map<string, string>,
    extensionMap: Map<string, LanguageDefinition>,
    gitCache?: object,
): Promise<FileState> => {
    if (shouldSkip(filePath)) {
        return { oid, languageId: undefined, lines: 0, testLines: 0 }
    }

    const ext = getExtension(filePath).toLowerCase()
    const lang = extensionMap.get(ext)

    const cacheKey = makeBlobCacheKey(oid, filePath)
    const cached = blobCache.get(cacheKey)
    if (cached) {
        return { oid, languageId: cached.languageId, lines: cached.lines, testLines: cached.testLines }
    }

    let content: string | undefined = contentCache.get(oid)
    let lines: number

    if (content !== undefined) {
        lines = countLines(content)
    } else {
        let blob: Uint8Array
        try {
            const result = await git.readBlob({ fs, dir, oid, cache: gitCache })
            blob = result.blob
        } catch {
            return { oid, languageId: undefined, lines: 0, testLines: 0 }
        }

        if (isBinary(blob)) {
            blobCache.set(cacheKey, { lines: 0, testLines: 0, languageId: undefined })
            return { oid, languageId: undefined, lines: 0, testLines: 0 }
        }

        try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(blob)
            contentCache.set(oid, content)
            lines = countLines(content)
        } catch {
            // Non-UTF-8: count newline bytes directly, skip inline test detection
            lines = countLinesFromBytes(blob)
            content = undefined
        }
    }

    const basename = getBasename(filePath)

    if (!lang) {
        const testLines = isInTestDir(filePath) ? lines : 0
        blobCache.set(cacheKey, { lines, testLines, languageId: 'other' })
        return { oid, languageId: 'other', lines, testLines }
    }

    const langId = lang.id
    const classification = classifyFile(filePath, basename, content, lines, lang)

    blobCache.set(cacheKey, {
        lines: classification.lines,
        testLines: classification.testLines,
        languageId: langId,
    })

    return {
        oid,
        languageId: langId,
        lines: classification.lines,
        testLines: classification.testLines,
    }
}

type DiffEntry =
    | { type: 'added'; path: string; newOid: string }
    | { type: 'modified'; path: string; oldOid: string; newOid: string }
    | { type: 'deleted'; path: string; oldOid: string }

export const diffTreesDetailed = async (options: {
    fs: FsClient
    dir: string
    prevTreeOid: string | undefined
    currTreeOid: string | undefined
    treeCache: Map<string, TreeEntry[]>
    gitCache?: object
}): Promise<DiffEntry[]> => {
    const { fs, dir, prevTreeOid, currTreeOid, treeCache, gitCache } = options
    const results: DiffEntry[] = []

    const collectDeletedBlobs = async (treeOid: string, basePath: string) => {
        const entries = await readTreeCached(fs, dir, treeOid, treeCache, gitCache)
        for (const entry of entries) {
            const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
            if (entry.type === 'blob') {
                results.push({ type: 'deleted', path: fullPath, oldOid: entry.oid })
            } else if (entry.type === 'tree') {
                if (!shouldSkipDir(entry.path)) {
                    await collectDeletedBlobs(entry.oid, fullPath)
                }
            }
        }
    }

    const walkDiff = async (prevOid: string | undefined, currOid: string | undefined, basePath: string) => {
        if (prevOid === currOid) return

        const prevEntries = prevOid ? await readTreeCached(fs, dir, prevOid, treeCache, gitCache) : []
        const currEntries = currOid ? await readTreeCached(fs, dir, currOid, treeCache, gitCache) : []

        const prevMap = new Map(prevEntries.map((e) => [e.path, e]))
        const currMap = new Map(currEntries.map((e) => [e.path, e]))

        // Process current entries (additions and modifications)
        for (const entry of currEntries) {
            const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
            const prev = prevMap.get(entry.path)

            if (entry.type === 'blob') {
                if (!prev || prev.type !== 'blob') {
                    results.push({ type: 'added', path: fullPath, newOid: entry.oid })
                } else if (prev.oid !== entry.oid) {
                    results.push({ type: 'modified', path: fullPath, oldOid: prev.oid, newOid: entry.oid })
                }
            } else if (entry.type === 'tree') {
                if (!shouldSkipDir(entry.path)) {
                    const prevSubOid = prev && prev.type === 'tree' ? prev.oid : undefined
                    await walkDiff(prevSubOid, entry.oid, fullPath)
                }
            }
        }

        // Process deletions (in prev but not in curr)
        for (const entry of prevEntries) {
            if (currMap.has(entry.path)) continue
            const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path
            if (entry.type === 'blob') {
                results.push({ type: 'deleted', path: fullPath, oldOid: entry.oid })
            } else if (entry.type === 'tree') {
                if (!shouldSkipDir(entry.path)) {
                    await collectDeletedBlobs(entry.oid, fullPath)
                }
            }
        }
    }

    await walkDiff(prevTreeOid, currTreeOid, '')
    return results
}

/** Diff-based: only processes files changed between prevCommitOid and commitOid. */
export const countLinesForCommitIncremental = async (
    options: CountOptions & { prevCommitOid: string },
    fileStateMap: Map<string, FileState>,
    allExtensions: Set<string>,
    date: string,
    messages: string[],
): Promise<DayStats> => {
    const { fs, dir, commitOid, prevCommitOid, blobCache, contentCache, signal, gitCache } = options
    const treeCache = options.treeCache ?? new Map<string, TreeEntry[]>()

    // Read commit objects to get root tree OIDs
    const prevCommit = await git.readCommit({ fs, dir, oid: prevCommitOid, cache: gitCache })
    const currCommit = await git.readCommit({ fs, dir, oid: commitOid, cache: gitCache })
    const prevRootTree = prevCommit.commit.tree
    const currRootTree = currCommit.commit.tree

    // Diff trees recursively using cached tree reads
    const diffEntries = await diffTreesDetailed({
        fs,
        dir,
        prevTreeOid: prevRootTree,
        currTreeOid: currRootTree,
        treeCache,
        gitCache,
    })

    // Map DiffEntry results back into the existing added/modified/deleted arrays
    const added: FileEntry[] = []
    const modified: FileEntry[] = []
    const deleted: string[] = []

    for (const entry of diffEntries) {
        switch (entry.type) {
            case 'added':
                added.push({ path: entry.path, oid: entry.newOid })
                break
            case 'modified':
                modified.push({ path: entry.path, oid: entry.newOid })
                break
            case 'deleted':
                deleted.push(entry.path)
                break
        }
    }

    if (signal?.aborted) throw new Error('Cancelled')

    // Process deletions
    for (const filepath of deleted) {
        fileStateMap.delete(filepath)
    }

    // Update allExtensions with new/modified files
    for (const file of [...added, ...modified]) {
        allExtensions.add(getExtension(file.path).toLowerCase())
    }

    // Re-resolve header language mapping with updated extensions
    const extensionMap = resolveHeaderLanguage(allExtensions)

    // Process added and modified files in parallel with concurrency limit
    const changedFiles = [...added, ...modified]
    const limit = createLimiter(8)
    const fileResults = await Promise.all(
        changedFiles.map((file) => {
            if (signal?.aborted) throw new Error('Cancelled')
            return limit(() =>
                processFile(file.path, file.oid, fs, dir, blobCache, contentCache, extensionMap, gitCache),
            )
        }),
    )

    for (let i = 0; i < changedFiles.length; i++) {
        fileStateMap.set(changedFiles[i].path, fileResults[i])
    }

    return computeDayStatsFromFileState(fileStateMap, date, messages)
}

interface CommitContribution {
    languageAdded: Record<string, number>
    languageRemoved: Record<string, number>
    totalDelta: number
    totalAdded: number
    totalRemoved: number
}

export const computeCommitContribution = async (options: {
    fs: FsClient
    dir: string
    commitOid: string
    parentOid: string | undefined
    blobCache: Map<string, BlobCacheEntry>
    contentCache: Map<string, string>
    treeCache: Map<string, TreeEntry[]>
    allExtensions: Set<string>
    gitCache?: object
}): Promise<CommitContribution> => {
    const { fs, dir, commitOid, parentOid, blobCache, contentCache, treeCache, allExtensions, gitCache } = options

    // Read commit tree OIDs
    const currCommit = await git.readCommit({ fs, dir, oid: commitOid, cache: gitCache })
    const currTreeOid = currCommit.commit.tree

    let prevTreeOid: string | undefined
    if (parentOid !== undefined) {
        const parentCommit = await git.readCommit({ fs, dir, oid: parentOid, cache: gitCache })
        prevTreeOid = parentCommit.commit.tree
    }

    // Diff the trees
    const diffEntries = await diffTreesDetailed({
        fs,
        dir,
        prevTreeOid,
        currTreeOid,
        treeCache,
        gitCache,
    })

    const extensionMap = resolveHeaderLanguage(allExtensions)
    const limit = createLimiter(8)

    const languageAdded: Record<string, number> = {}
    const languageRemoved: Record<string, number> = {}

    // Process all diff entries in parallel
    const entryResults = await Promise.all(
        diffEntries.map((entry) =>
            limit(async () => {
                switch (entry.type) {
                    case 'added': {
                        const state = await processFile(
                            entry.path,
                            entry.newOid,
                            fs,
                            dir,
                            blobCache,
                            contentCache,
                            extensionMap,
                            gitCache,
                        )
                        return { type: 'added' as const, langId: state.languageId, lines: state.lines }
                    }
                    case 'deleted': {
                        const state = await processFile(
                            entry.path,
                            entry.oldOid,
                            fs,
                            dir,
                            blobCache,
                            contentCache,
                            extensionMap,
                            gitCache,
                        )
                        return { type: 'deleted' as const, langId: state.languageId, lines: state.lines }
                    }
                    case 'modified': {
                        const [oldState, newState] = await Promise.all([
                            processFile(
                                entry.path,
                                entry.oldOid,
                                fs,
                                dir,
                                blobCache,
                                contentCache,
                                extensionMap,
                                gitCache,
                            ),
                            processFile(
                                entry.path,
                                entry.newOid,
                                fs,
                                dir,
                                blobCache,
                                contentCache,
                                extensionMap,
                                gitCache,
                            ),
                        ])
                        return {
                            type: 'modified' as const,
                            langId: newState.languageId,
                            oldLines: oldState.lines,
                            newLines: newState.lines,
                        }
                    }
                }
            }),
        ),
    )

    // Aggregate results
    for (const result of entryResults) {
        const langId = result.langId
        if (!langId) continue

        switch (result.type) {
            case 'added': {
                languageAdded[langId] = (languageAdded[langId] ?? 0) + result.lines
                break
            }
            case 'deleted': {
                languageRemoved[langId] = (languageRemoved[langId] ?? 0) + result.lines
                break
            }
            case 'modified': {
                const delta = result.newLines - result.oldLines
                if (delta > 0) {
                    languageAdded[langId] = (languageAdded[langId] ?? 0) + delta
                } else if (delta < 0) {
                    languageRemoved[langId] = (languageRemoved[langId] ?? 0) + -delta
                }
                break
            }
        }
    }

    let totalAdded = 0
    let totalRemoved = 0
    for (const count of Object.values(languageAdded)) {
        totalAdded += count
    }
    for (const count of Object.values(languageRemoved)) {
        totalRemoved += count
    }

    return {
        languageAdded,
        languageRemoved,
        totalDelta: totalAdded - totalRemoved,
        totalAdded,
        totalRemoved,
    }
}

interface Classification {
    lines: number
    testLines: number
    hasSplit: boolean
}

const classifyFile = (
    filePath: string,
    basename: string,
    content: string | undefined,
    lines: number,
    lang: LanguageDefinition,
): Classification => {
    // 0. No prod/test split for this language
    if (lang.noTestSplit) {
        return { lines, testLines: 0, hasSplit: false }
    }

    // 1. Test directory matching (checked first so test-dir files aren't misclassified by inline detection)
    const dirPatterns = lang.testDirPatterns ?? defaultTestDirPatterns
    if (isInTestDir(filePath, dirPatterns)) {
        return { lines, testLines: lines, hasSplit: true }
    }

    // 2. Test file pattern matching
    if (lang.testFilePatterns && isTestFile(basename, lang.testFilePatterns)) {
        return { lines, testLines: lines, hasSplit: true }
    }

    // 3. Inline test detection (e.g., Rust #[cfg(test)], Zig test blocks)
    // Skipped when content is unavailable (non-UTF-8 files)
    if (content && lang.countInlineTestLines) {
        const testLines = lang.countInlineTestLines(content)
        return { lines, testLines, hasSplit: true }
    }

    // 4. Default: all prod
    return { lines, testLines: 0, hasSplit: true }
}
