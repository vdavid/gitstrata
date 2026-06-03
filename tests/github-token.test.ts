import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    readStoredToken,
    writeStoredToken,
    clearStoredToken,
    maskToken,
    verifyGithubToken,
} from '../src/lib/github-token'

const makeLocalStorage = () => {
    const store = new Map<string, string>()
    return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
    }
}

describe('github-token storage', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', makeLocalStorage())
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('round-trips a stored token', () => {
        const entry = { token: 'github_pat_abc123', account: 'octocat', addedAt: '2026-01-01T00:00:00Z' }
        writeStoredToken(entry)
        expect(readStoredToken()).toEqual(entry)
    })

    it('returns undefined when nothing is stored', () => {
        expect(readStoredToken()).toBeUndefined()
    })

    it('clears a stored token', () => {
        writeStoredToken({ token: 't', account: 'a', addedAt: '2026-01-01T00:00:00Z' })
        clearStoredToken()
        expect(readStoredToken()).toBeUndefined()
    })

    it('treats a corrupt entry as absent', () => {
        localStorage.setItem('gitstrata-github-token', 'not json')
        expect(readStoredToken()).toBeUndefined()
    })

    it('ignores an entry missing required fields', () => {
        localStorage.setItem('gitstrata-github-token', JSON.stringify({ token: 't' }))
        expect(readStoredToken()).toBeUndefined()
    })
})

describe('maskToken', () => {
    it('keeps a known prefix and the last four chars', () => {
        expect(maskToken('github_pat_11ABCDEFG_longtail9999')).toBe('github_pat_…9999')
        expect(maskToken('ghp_abcdefghijklmnop')).toBe('ghp_…mnop')
    })

    it('masks tokens without a known prefix', () => {
        expect(maskToken('plainsecret1234')).toBe('…1234')
    })
})

describe('verifyGithubToken', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns the login on success', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200 })),
        )
        expect(await verifyGithubToken('t')).toEqual({ login: 'octocat' })
    })

    it('sends the token as a Bearer header to api.github.com', async () => {
        const fetchSpy = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
            async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200 }),
        )
        vi.stubGlobal('fetch', fetchSpy)
        await verifyGithubToken('secret')
        const [url, init] = fetchSpy.mock.calls[0]
        expect(url).toBe('https://api.github.com/user')
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
    })

    it('throws a friendly error on 401', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 401 })),
        )
        await expect(verifyGithubToken('bad')).rejects.toThrow(/didn't work/)
    })

    it('throws when the response lacks a login', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
        )
        await expect(verifyGithubToken('t')).rejects.toThrow(/account/)
    })
})
