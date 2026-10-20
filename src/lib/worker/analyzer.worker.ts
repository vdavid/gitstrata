import { Buffer } from 'buffer'
// isomorphic-git expects Buffer to be globally available in the browser
;(globalThis as unknown as Record<string, unknown>).Buffer = Buffer

import * as Comlink from 'comlink'
import git from 'isomorphic-git'
import LightningFS from '@isomorphic-git/lightning-fs'
import { configureSync, getConsoleSink, getLogger } from '@logtape/logtape'
import type { AnalysisResult, ErrorKind, ProgressEvent } from '../types'
import { cloneRepo, detectDefaultBranch, fetchRepo, getRemoteBranchHead, waitForBodyCleanups } from '../git/clone'
import { analyzeLocalRepo, rollOnAnalysis, type LocalRepo } from '../git/pipeline'
import { parseRepoUrl, repoToDir, repoToFsName } from '../url'

// Configure LogTape for the worker context
configureSync({
    sinks: { console: getConsoleSink() },
    loggers: [{ category: 'git-strata', lowestLevel: 'debug', sinks: ['console'] }],
})

const logger = getLogger(['git-strata', 'pipeline'])

type ProgressCallback = (event: ProgressEvent) => void

const classifyError = (error: unknown): { message: string; kind: ErrorKind } => {
    const raw = error instanceof Error ? error.message : String(error)
    const lower = raw.toLowerCase()

    if (lower.includes('404') || lower.includes('not found'))
        return {
            message: "Couldn't find this repository. Check the URL and make sure it's public.",
            kind: 'not-found',
        }

    if (lower.includes('401') || lower.includes('403') || lower.includes('auth'))
        return {
            message: 'This looks like a private repository. You need a GitHub token to analyze your private repos.',
            kind: 'auth-required',
        }

    if (
        lower.includes('cors') ||
        lower.includes('failed to fetch') ||
        lower.includes('load failed') ||
        lower.includes('networkerror')
    ) {
        if (lower.includes('network') || lower.includes('offline') || lower.includes('lost'))
            return {
                message: 'Network connection lost. Reconnect and try again.',
                kind: 'network-lost',
            }
        return {
            message: 'Our download proxy is temporarily unavailable. Please try again in a moment.',
            kind: 'cors-proxy-down',
        }
    }

    if (lower.includes('timed out'))
        return {
            message: 'The connection timed out — the repository may be too large to clone in the browser.',
            kind: 'repo-too-large',
        }

    if (lower.includes('quota') || lower.includes('storage') || lower.includes('indexeddb'))
        return {
            message: "Your browser's storage is full. Clear some cached repos in the footer menu.",
            kind: 'indexeddb-full',
        }

    if (lower.includes('abort') || lower.includes('cancel'))
        return { message: 'Analysis cancelled.', kind: 'cancelled' }

    return { message: raw, kind: 'unknown' }
}

const throwIfAborted = (signal: AbortSignal) => {
    if (signal.aborted) throw new Error('Cancelled')
}

/** Clone into LightningFS, wiping the database on failure so a retry doesn't read half-written pack files. */
const cloneFresh = async (options: Parameters<typeof cloneRepo>[0] & { fsName: string }): Promise<void> => {
    const { fsName, ...cloneOptions } = options
    options.onProgress?.({ type: 'clone', phase: 'Counting objects', loaded: 0, total: 0 })
    logger.info('Starting: clone {url} ({branch})', { url: options.url, branch: options.defaultBranch })
    try {
        await cloneRepo(cloneOptions)
    } catch (cloneError) {
        logger.warning('Clone failed, wiping LightningFS database "{fsName}"', { fsName })
        new LightningFS(fsName, { wipe: true })
        throw cloneError
    }
    logger.info('Clone complete')
}

/** Run a pipeline step, reporting failures as classified `error` progress events. */
const reportErrors = async (onProgress: ProgressCallback, run: () => Promise<AnalysisResult>) => {
    try {
        const result = await run()
        onProgress({ type: 'done', result })
        return result
    } catch (error) {
        const classified = classifyError(error)
        logger.error('Pipeline error: {kind} — {message}', { kind: classified.kind, message: classified.message })
        onProgress({ type: 'error', message: classified.message, kind: classified.kind })
        throw error
    }
}

let abortController: AbortController | undefined

const analyzerApi = {
    async cancel() {
        abortController?.abort()
        await waitForBodyCleanups()
    },

    async analyze(
        repoInput: string,
        corsProxy: string,
        githubToken: string | undefined,
        onProgress: ProgressCallback,
    ): Promise<AnalysisResult> {
        abortController = new AbortController()
        const signal = abortController.signal
        const parsed = parseRepoUrl(repoInput)
        const dir = repoToDir(parsed)
        const fsName = repoToFsName(parsed)
        const fs = new LightningFS(fsName)

        return reportErrors(onProgress, async () => {
            onProgress({ type: 'clone', phase: 'Detecting default branch...', loaded: 0, total: 0 })
            logger.info('Starting: detect default branch for {url}', { url: parsed.url })
            const defaultBranch = await detectDefaultBranch({ url: parsed.url, corsProxy, githubToken, signal })
            logger.info('Detected branch: {branch}', { branch: defaultBranch })
            throwIfAborted(signal)

            const cloneOptions = { fs, dir, url: parsed.url, corsProxy, githubToken, defaultBranch, onProgress, signal }
            await cloneFresh({ ...cloneOptions, fsName })
            throwIfAborted(signal)

            const headOid = await git.resolveRef({ fs, dir, ref: defaultBranch })
            const repo: LocalRepo = { fs, dir, repoUrl: parsed.url, defaultBranch, headOid, signal, onProgress }
            const result = await analyzeLocalRepo(repo)
            logger.info('Analysis complete ({count} days)', { count: result.days.length })
            return result
        })
    },

    /**
     * Bring a cached result up to the remote's current HEAD. Fetches into the persisted clone (or clones when this
     * device has none), then recounts only the days that new commits affect. See `rollOnAnalysis`.
     */
    async analyzeIncremental(
        repoInput: string,
        corsProxy: string,
        githubToken: string | undefined,
        cachedResult: AnalysisResult,
        onProgress: ProgressCallback,
    ): Promise<AnalysisResult> {
        abortController = new AbortController()
        const signal = abortController.signal
        const parsed = parseRepoUrl(repoInput)
        const dir = repoToDir(parsed)
        const fsName = repoToFsName(parsed)
        const fs = new LightningFS(fsName)
        const defaultBranch = cachedResult.defaultBranch
        const localBranchRef = `refs/heads/${defaultBranch}`

        return reportErrors(onProgress, async () => {
            const cloneOptions = { fs, dir, url: parsed.url, corsProxy, githubToken, defaultBranch, onProgress, signal }
            const hasLocalClone = await git.resolveRef({ fs, dir, ref: localBranchRef }).then(
                () => true,
                () => false,
            )

            if (hasLocalClone) {
                onProgress({ type: 'clone', phase: 'Fetching new commits', loaded: 0, total: 0 })
                logger.info('Starting: fetch {url} ({branch})', { url: parsed.url, branch: defaultBranch })
                await fetchRepo(cloneOptions)
                logger.info('Fetch complete')
                // git.fetch only moves the remote-tracking ref; point the local branch at it too
                const fetchedOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${defaultBranch}` })
                await git.writeRef({ fs, dir, ref: localBranchRef, value: fetchedOid, force: true })
            } else {
                await cloneFresh({ ...cloneOptions, fsName })
            }
            throwIfAborted(signal)

            const headOid = await git.resolveRef({ fs, dir, ref: localBranchRef })
            const repo: LocalRepo = { fs, dir, repoUrl: parsed.url, defaultBranch, headOid, signal, onProgress }
            const result = await rollOnAnalysis(repo, cachedResult)
            logger.info('Roll-on complete ({count} days)', { count: result.days.length })
            return result
        })
    },

    /** Cheap freshness check: the remote's current tip of `branch`, or undefined when it can't be read. */
    async getRemoteHead(
        repoInput: string,
        corsProxy: string,
        githubToken: string | undefined,
        branch: string,
    ): Promise<string | undefined> {
        try {
            return await getRemoteBranchHead({ url: parseRepoUrl(repoInput).url, corsProxy, branch, githubToken })
        } catch (error) {
            logger.warning('Remote HEAD check failed: {error}', { error: String(error) })
            return undefined
        }
    },
}

export type AnalyzerApi = typeof analyzerApi

Comlink.expose(analyzerApi)
