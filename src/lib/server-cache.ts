import { PUBLIC_SHARED_CACHE_URL } from '$app/env/public'
import { readWriteKey } from './write-key'
import type { AnalysisResult, SharedCacheEntry } from './types'

const getBaseUrl = (): string | undefined => PUBLIC_SHARED_CACHE_URL

/** SHA-256 hash a string, returned as hex */
const sha256 = async (input: string): Promise<string> => {
    const data = new TextEncoder().encode(input)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Gzip-compress a string using the CompressionStream API */
const gzipCompress = async (input: string): Promise<Blob> => {
    const blob = new Blob([input])
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
    return new Response(stream).blob()
}

const isValidCacheEntry = (data: unknown): data is SharedCacheEntry => {
    if (typeof data !== 'object' || data === null) return false
    const obj = data as Record<string, unknown>
    if (obj.version !== 1) return false
    if (typeof obj.repoUrl !== 'string') return false
    if (typeof obj.headCommit !== 'string') return false
    if (typeof obj.updatedAt !== 'string') return false
    if (typeof obj.result !== 'object' || obj.result === null) return false
    const result = obj.result as Record<string, unknown>
    return Array.isArray(result.days)
}

/**
 * Fetch a cached result from the shared server cache.
 * Returns undefined on miss, error, or when the cache is disabled.
 */
export const fetchServerResult = async (repoUrl: string): Promise<SharedCacheEntry | undefined> => {
    const baseUrl = getBaseUrl()
    if (!baseUrl) return undefined

    try {
        const repoHash = await sha256(repoUrl)
        const response = await fetch(`${baseUrl}/cache/v1/${repoHash}`)
        if (!response.ok) return undefined
        const data: unknown = await response.json()
        if (!isValidCacheEntry(data)) return undefined
        return data
    } catch {
        return undefined
    }
}

/**
 * Upload a result to the shared server cache. Only trusted devices (holding a write key) upload, and never a result
 * analyzed with a GitHub token, since that may be a private repo.
 * No-ops silently on error, without a key, or when the cache is disabled. Resolves to whether the proxy stored it.
 */
export const uploadServerResult = async (
    result: AnalysisResult,
    { usedGithubToken }: { usedGithubToken: boolean },
): Promise<boolean> => {
    const baseUrl = getBaseUrl()
    const writeKey = readWriteKey()
    if (!baseUrl || !writeKey || usedGithubToken) return false

    try {
        const entry: SharedCacheEntry = {
            version: 1,
            repoUrl: result.repoUrl,
            headCommit: result.headCommit,
            result,
            updatedAt: new Date().toISOString(),
        }

        const repoHash = await sha256(result.repoUrl)
        const compressed = await gzipCompress(JSON.stringify(entry))

        // The proxy never parses the body (CPU budget), so the headers tell it what this upload is.
        const response = await fetch(`${baseUrl}/cache/v1/${repoHash}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${writeKey}`,
                'X-Repo-Url': result.repoUrl,
                'X-Head-Commit': result.headCommit,
                'Content-Type': 'application/json',
                'Content-Encoding': 'gzip',
            },
            body: compressed,
        })
        return response.ok
    } catch {
        // Silently ignore — server cache is best-effort
        return false
    }
}
