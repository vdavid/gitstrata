import git, { type FsClient, type HttpClient } from 'isomorphic-git'
import { getLogger } from '@logtape/logtape'
import type { ProgressEvent } from '../types'

const sizeWarningThreshold = 1_073_741_824 // 1 GB

// Collects body cancellation promises so callers can await full HTTP cleanup.
const pendingBodyCleanups: Promise<void>[] = []

/** Wait for all in-flight response body cancellations to complete, then clear the list. */
export const waitForBodyCleanups = (): Promise<void> => {
    const result = Promise.all(pendingBodyCleanups).then(() => {})
    pendingBodyCleanups.length = 0
    return result
}

const httpLogger = getLogger(['git-strata', 'http'])
const cloneLogger = getLogger(['git-strata', 'clone'])

const makeAbortableHttp = (signal?: AbortSignal): HttpClient => ({
    request: async ({ url, method = 'GET', headers = {}, body, onProgress }) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        httpLogger.info('Request: {method} {url}', { method, url })

        // Collect async iterable request body into a single buffer
        let requestBody: Uint8Array | undefined
        if (body) {
            const chunks: Uint8Array[] = []
            for await (const chunk of body) {
                chunks.push(chunk)
            }
            const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
            requestBody = new Uint8Array(totalLength)
            let offset = 0
            for (const chunk of chunks) {
                requestBody.set(chunk, offset)
                offset += chunk.byteLength
            }
        }

        const res = await fetch(url, {
            method,
            headers,
            body: requestBody as BodyInit | undefined,
            signal,
        })
        httpLogger.info('Response: {statusCode}', { statusCode: res.status })

        const responseHeaders: Record<string, string> = {}
        res.headers.forEach((value, key) => {
            responseHeaders[key] = value
        })

        // Cancel the response body on abort even if the generator was never iterated.
        // Without this, unconsumed response bodies hold TCP connections open indefinitely.
        // The cancel promise is tracked in pendingBodyCleanups so callers can await full cleanup.
        signal?.addEventListener(
            'abort',
            () => {
                const p = res.body?.cancel().catch(() => {})
                if (p) pendingBodyCleanups.push(p)
                httpLogger.debug('Abort: cancelled response body for {method} {url}', { method, url })
            },
            { once: true },
        )

        // Stream response body as async iterable with progress tracking
        async function* iterateBody(): AsyncGenerator<Uint8Array> {
            if (!res.body) {
                const buf = new Uint8Array(await res.arrayBuffer())
                if (buf.byteLength > 0) {
                    onProgress?.({ phase: 'downloading', loaded: buf.byteLength, total: 0 })
                    yield buf
                }
                return
            }
            const reader = res.body.getReader()
            let loaded = 0
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) return
                    loaded += value.byteLength
                    onProgress?.({ phase: 'downloading', loaded, total: 0 })
                    yield value
                }
            } finally {
                reader.cancel().catch((error: unknown) => {
                    // AbortError is expected — means the abort listener already cleaned up
                    if (error instanceof DOMException && error.name === 'AbortError') return
                    httpLogger.warning('Failed to cancel body reader for {method} {url}: {error}', {
                        method,
                        url,
                        error,
                    })
                })
                httpLogger.debug('Closed response body for {method} {url}', { method, url })
            }
        }

        return {
            url: res.url,
            method,
            statusCode: res.status,
            statusMessage: res.statusText,
            body: iterateBody(),
            headers: responseHeaders,
        }
    },
})

interface CloneOptions {
    fs: FsClient
    dir: string
    url: string
    corsProxy: string
    onProgress?: (event: ProgressEvent) => void
    signal?: AbortSignal
}

// --- Staleness monitor: detects stuck connections and aborts after timeout ---

// GitHub and other hosts send large pack files in bursts with long pauses between them.
// Base timeout is generous; once significant data has been received, we extend further
// since the connection is clearly working — just bursty.
const baseTimeoutMs = 300_000 // 5 minutes
const extendedTimeoutMs = 1_200_000 // 20 minutes
const extensionThreshold = 10_485_760 // 10 MB — once this much data has been received, extend timeout

interface StalenessMonitor {
    signal: AbortSignal
    markProgress: (loaded?: number) => void
    wasTimeout: () => boolean
    effectiveTimeoutMs: () => number
    cleanup: () => void
}

const createStalenessMonitor = (externalSignal: AbortSignal | undefined, label: string): StalenessMonitor => {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    externalSignal?.addEventListener('abort', forwardAbort, { once: true })

    let lastProgressTime = Date.now()
    let maxLoaded = 0
    let timedOut = false

    const getEffectiveTimeout = () => (maxLoaded > extensionThreshold ? extendedTimeoutMs : baseTimeoutMs)

    const timer = setInterval(() => {
        const silentMs = Date.now() - lastProgressTime
        const timeout = getEffectiveTimeout()
        if (silentMs > timeout) {
            timedOut = true
            controller.abort()
        } else if (silentMs > 60_000) {
            cloneLogger.error('{label}: no data for {seconds}s — timeout at {timeoutMin} min', {
                label,
                seconds: Math.round(silentMs / 1000),
                timeoutMin: Math.round(timeout / 60_000),
            })
        } else if (silentMs > 30_000) {
            cloneLogger.warning('{label}: no data for {seconds}s', {
                label,
                seconds: Math.round(silentMs / 1000),
            })
        }
    }, 5_000)

    return {
        signal: controller.signal,
        markProgress: (loaded?: number) => {
            lastProgressTime = Date.now()
            if (loaded !== undefined && loaded > maxLoaded) {
                maxLoaded = loaded
            }
        },
        wasTimeout: () => timedOut,
        effectiveTimeoutMs: getEffectiveTimeout,
        cleanup: () => {
            clearInterval(timer)
            externalSignal?.removeEventListener('abort', forwardAbort)
        },
    }
}

const defaultBranchTimeoutMs = 30_000

export const detectDefaultBranch = async (options: {
    url: string
    corsProxy: string
    signal?: AbortSignal
}): Promise<string> => {
    cloneLogger.info('Detecting default branch...')
    // Unlike clone/fetch (which use StalenessMonitor for long-running transfers),
    // ref discovery is a small, fast request — if it can't complete in 30s the server is unreachable.
    const signal = AbortSignal.any([
        ...(options.signal ? [options.signal] : []),
        AbortSignal.timeout(defaultBranchTimeoutMs),
    ])
    const abortableHttp = makeAbortableHttp(signal)
    const refs = await git.listServerRefs({
        http: abortableHttp,
        corsProxy: options.corsProxy,
        url: options.url,
        prefix: 'HEAD',
        symrefs: true,
        protocolVersion: 2,
    })
    // Find HEAD's symref target (e.g. "refs/heads/main")
    const head = refs.find((r) => r.ref === 'HEAD')
    if (head?.target) {
        // Strip "refs/heads/" prefix to get the branch name
        return head.target.replace(/^refs\/heads\//, '')
    }
    // Fallback: list all branches and try common names
    const allRefs = await git.listServerRefs({
        http: abortableHttp,
        corsProxy: options.corsProxy,
        url: options.url,
        prefix: 'refs/heads/',
        protocolVersion: 2,
    })
    const branchNames = new Set(allRefs.map((r) => r.ref.replace(/^refs\/heads\//, '')))
    if (branchNames.has('main')) return 'main'
    if (branchNames.has('master')) return 'master'
    cloneLogger.error('Failed to detect default branch — no main or master found')
    throw new Error('Could not detect default branch')
}

export const cloneRepo = async (options: CloneOptions & { defaultBranch: string }): Promise<void> => {
    const { fs, dir, url, corsProxy, defaultBranch, onProgress, signal } = options

    // Ensure directory exists (lightning-fs supports promises.mkdir)
    try {
        const pfs = (
            fs as unknown as {
                promises: { mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void> }
            }
        ).promises
        await pfs.mkdir(dir, { recursive: true })
    } catch {
        // Directory may already exist
    }

    const monitor = createStalenessMonitor(signal, 'Clone')
    const abortableHttp = makeAbortableHttp(monitor.signal)
    let sizeWarningEmitted = false

    // Progress logging state
    let prevPhase = ''
    let phaseTickCount = 0

    try {
        await git.clone({
            fs,
            http: abortableHttp,
            dir,
            url,
            corsProxy,
            singleBranch: true,
            ref: defaultBranch,
            onProgress: (event) => {
                if (monitor.signal.aborted) return
                const total = event.total ?? 0

                monitor.markProgress(event.loaded)

                // Sampled progress logging
                if (event.phase !== prevPhase) {
                    cloneLogger.info('Clone progress: phase={phase} loaded={loaded} total={total}', {
                        phase: event.phase,
                        loaded: event.loaded,
                        total,
                    })
                    prevPhase = event.phase
                    phaseTickCount = 0
                } else {
                    phaseTickCount++
                    if (phaseTickCount % 10 === 0 || (total > 0 && event.loaded >= total)) {
                        cloneLogger.info('Clone progress: phase={phase} loaded={loaded} total={total}', {
                            phase: event.phase,
                            loaded: event.loaded,
                            total,
                        })
                    }
                }

                onProgress?.({
                    type: 'clone',
                    phase: event.phase,
                    loaded: event.loaded,
                    total,
                })
                if (!sizeWarningEmitted && total > sizeWarningThreshold) {
                    sizeWarningEmitted = true
                    onProgress?.({ type: 'size-warning', estimatedBytes: total })
                }
            },
            onAuth: () => ({ cancel: true }),
        })
    } catch (error) {
        if (monitor.wasTimeout()) {
            const timeoutMin = Math.round(monitor.effectiveTimeoutMs() / 60_000)
            throw new Error(`Connection timed out — no data received for ${timeoutMin} minutes.`, { cause: error })
        }
        throw error
    } finally {
        monitor.cleanup()
    }
}

export const fetchRepo = async (options: CloneOptions & { defaultBranch: string }): Promise<void> => {
    const { fs, dir, url, corsProxy, defaultBranch, onProgress, signal } = options

    const monitor = createStalenessMonitor(signal, 'Fetch')
    const abortableHttp = makeAbortableHttp(monitor.signal)

    // Progress logging state
    let prevPhase = ''
    let phaseTickCount = 0

    try {
        await git.fetch({
            fs,
            http: abortableHttp,
            dir,
            url,
            corsProxy,
            singleBranch: true,
            ref: defaultBranch,
            onProgress: (event) => {
                if (monitor.signal.aborted) return
                const total = event.total ?? 0

                monitor.markProgress(event.loaded)

                // Sampled progress logging
                if (event.phase !== prevPhase) {
                    cloneLogger.info('Fetch progress: phase={phase} loaded={loaded} total={total}', {
                        phase: event.phase,
                        loaded: event.loaded,
                        total,
                    })
                    prevPhase = event.phase
                    phaseTickCount = 0
                } else {
                    phaseTickCount++
                    if (phaseTickCount % 10 === 0 || (total > 0 && event.loaded >= total)) {
                        cloneLogger.info('Fetch progress: phase={phase} loaded={loaded} total={total}', {
                            phase: event.phase,
                            loaded: event.loaded,
                            total,
                        })
                    }
                }

                onProgress?.({
                    type: 'clone',
                    phase: event.phase,
                    loaded: event.loaded,
                    total,
                })
            },
            onAuth: () => ({ cancel: true }),
        })
    } catch (error) {
        if (monitor.wasTimeout()) {
            const timeoutMin = Math.round(monitor.effectiveTimeoutMs() / 60_000)
            throw new Error(`Connection timed out — no data received for ${timeoutMin} minutes.`, { cause: error })
        }
        throw error
    } finally {
        monitor.cleanup()
    }
}
