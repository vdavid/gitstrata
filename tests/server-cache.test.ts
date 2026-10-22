import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadServerResult } from '../src/lib/server-cache'
import type { AnalysisResult } from '../src/lib/types'

vi.mock('$app/env/public', () => ({ PUBLIC_SHARED_CACHE_URL: 'https://cache.test' }))

const makeLocalStorage = (initial: Record<string, string> = {}) => {
    const store = new Map<string, string>(Object.entries(initial))
    return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
    }
}

const headCommit = 'b'.repeat(40)
const result = {
    repoUrl: 'https://github.com/owner/repo',
    defaultBranch: 'main',
    analyzedAt: '2026-01-01T00:00:00Z',
    headCommit,
    detectedLanguages: [],
    days: [],
} as unknown as AnalysisResult

describe('uploadServerResult', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn(async () => new Response('Stored'))
        vi.stubGlobal('fetch', fetchMock)
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('does nothing without a write key', async () => {
        vi.stubGlobal('localStorage', makeLocalStorage())
        await uploadServerResult(result, { usedGithubToken: false })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does nothing when the analysis used a GitHub token', async () => {
        vi.stubGlobal('localStorage', makeLocalStorage({ 'gitstrata-write-key': 'my-key' }))
        await uploadServerResult(result, { usedGithubToken: true })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('uploads with the write key and descriptive headers', async () => {
        vi.stubGlobal('localStorage', makeLocalStorage({ 'gitstrata-write-key': 'my-key' }))
        await uploadServerResult(result, { usedGithubToken: false })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toMatch(/^https:\/\/cache\.test\/cache\/v1\/[0-9a-f]{64}$/)
        expect(init.method).toBe('PUT')
        const headers = new Headers(init.headers)
        expect(headers.get('Authorization')).toBe('Bearer my-key')
        expect(headers.get('X-Repo-Url')).toBe('https://github.com/owner/repo')
        expect(headers.get('X-Head-Commit')).toBe(headCommit)
        expect(headers.get('Content-Encoding')).toBe('gzip')
        expect(init.body).toBeInstanceOf(Blob)
    })

    it('reports whether the upload went through', async () => {
        vi.stubGlobal('localStorage', makeLocalStorage({ 'gitstrata-write-key': 'my-key' }))
        expect(await uploadServerResult(result, { usedGithubToken: false })).toBe(true)

        fetchMock.mockImplementation(async () => new Response('Forbidden', { status: 403 }))
        expect(await uploadServerResult(result, { usedGithubToken: false })).toBe(false)

        vi.stubGlobal('localStorage', makeLocalStorage())
        expect(await uploadServerResult(result, { usedGithubToken: false })).toBe(false)
    })
})
