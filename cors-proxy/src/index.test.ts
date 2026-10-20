import { describe, it, expect, vi, afterEach } from 'vitest'
import app from './index'
import { verifyHeadCommit } from './verify-head-commit'

vi.mock('./verify-head-commit', () => ({
    verifyHeadCommit: vi.fn(async () => null),
}))

async function sha256Hex(input: string): Promise<string> {
    const encoded = new TextEncoder().encode(input)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function gzip(data: string): Promise<ArrayBuffer> {
    const blob = new Blob([data])
    const compressed = blob.stream().pipeThrough(new CompressionStream('gzip'))
    return new Response(compressed).arrayBuffer()
}

const validCommit = 'a'.repeat(40)

function makeEntry(repoUrl = 'https://github.com/owner/repo') {
    return {
        version: 1,
        repoUrl,
        headCommit: validCommit,
        result: {
            repoUrl,
            defaultBranch: 'main',
            analyzedAt: '2025-01-01T00:00:00Z',
            headCommit: validCommit,
            detectedLanguages: [],
            days: [],
        },
        updatedAt: '2025-01-01T00:00:00Z',
    }
}

function mockR2Bucket(store: Map<string, ArrayBuffer | Uint8Array> = new Map()) {
    return {
        get: vi.fn(async (key: string) => {
            const data = store.get(key)
            if (!data) return null
            return {
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array(data))
                        controller.close()
                    },
                }),
            }
        }),
        put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array, _options?: unknown) => {
            store.set(key, value)
        }),
    }
}

// --- GET /cache/v1/:repoHash ---

describe('GET /cache/v1/:repoHash', () => {
    it('returns 404 when R2 binding is missing', async () => {
        const res = await app.request('/cache/v1/somehash', { method: 'GET' }, {})
        expect(res.status).toBe(404)
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('returns 404 when object does not exist in R2', async () => {
        const bucket = mockR2Bucket()
        const res = await app.request('/cache/v1/nonexistent', { method: 'GET' }, { RESULTS: bucket })
        expect(res.status).toBe(404)
    })

    it('returns cached object with correct headers', async () => {
        const entry = makeEntry()
        const compressed = await gzip(JSON.stringify(entry))
        const hash = await sha256Hex(entry.repoUrl)
        const store = new Map<string, ArrayBuffer>([[`results/v1/${hash}.json.gz`, compressed]])
        const bucket = mockR2Bucket(store)

        const res = await app.request(`/cache/v1/${hash}`, { method: 'GET' }, { RESULTS: bucket })
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Encoding')).toBe('gzip')
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
        expect(res.headers.get('Content-Type')).toBe('application/json')
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
})

// --- PUT /cache/v1/:repoHash ---

const writeKey = 'test-write-key-0123456789abcdef'

async function makePut(
    overrides: { repoUrl?: string; headers?: Record<string, string>; body?: ArrayBuffer | Uint8Array } = {},
) {
    const repoUrl = overrides.repoUrl ?? 'https://github.com/owner/repo'
    const body = overrides.body ?? (await gzip(JSON.stringify(makeEntry(repoUrl))))
    const headers: Record<string, string> = {
        authorization: `Bearer ${writeKey}`,
        'x-repo-url': repoUrl,
        'x-head-commit': validCommit,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(body.byteLength),
        ...overrides.headers,
    }
    return { hash: await sha256Hex(repoUrl), body, init: { method: 'PUT', body, headers } }
}

async function makeWriteEnv(bucket = mockR2Bucket()) {
    return { RESULTS: bucket, WRITE_KEY_HASHES: `${'0'.repeat(64)}, ${await sha256Hex(writeKey)}` }
}

describe('PUT /cache/v1/:repoHash', () => {
    afterEach(() => {
        vi.mocked(verifyHeadCommit).mockResolvedValue(null)
    })

    it('returns 404 when R2 binding is missing', async () => {
        const res = await app.request('/cache/v1/somehash', { method: 'PUT', body: 'data' }, {})
        expect(res.status).toBe(404)
    })

    it('stores a valid upload as-is with metadata', async () => {
        const bucket = mockR2Bucket()
        const { hash, body, init } = await makePut({ headers: { 'cf-connecting-ip': '10.0.0.1' } })

        const res = await app.request(`/cache/v1/${hash}`, init, await makeWriteEnv(bucket))

        expect(res.status).toBe(200)
        expect(await res.text()).toBe('Stored')
        expect(bucket.put).toHaveBeenCalledWith(
            `results/v1/${hash}.json.gz`,
            expect.any(Uint8Array),
            expect.objectContaining({
                httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
                customMetadata: expect.objectContaining({
                    repoUrl: 'https://github.com/owner/repo',
                    headCommit: validCommit,
                }),
            }),
        )
        const stored = bucket.put.mock.calls[0][1] as Uint8Array
        expect([...stored]).toEqual([...new Uint8Array(body)])
    })

    it('rejects a missing write key with 403', async () => {
        const { hash, init } = await makePut({ headers: { authorization: '', 'cf-connecting-ip': '10.0.0.2' } })
        const res = await app.request(`/cache/v1/${hash}`, init, await makeWriteEnv())
        expect(res.status).toBe(403)
    })

    it('rejects an invalid write key with 403', async () => {
        const { hash, init } = await makePut({
            headers: { authorization: 'Bearer wrong-key', 'cf-connecting-ip': '10.0.0.3' },
        })
        const res = await app.request(`/cache/v1/${hash}`, init, await makeWriteEnv())
        expect(res.status).toBe(403)
    })

    it('fails closed with 403 when no write keys are configured', async () => {
        const { hash, init } = await makePut({ headers: { 'cf-connecting-ip': '10.0.0.4' } })
        const res = await app.request(`/cache/v1/${hash}`, init, { RESULTS: mockR2Bucket() })
        expect(res.status).toBe(403)
    })

    it('rejects a repo hash that does not match X-Repo-Url', async () => {
        const { init } = await makePut({ headers: { 'cf-connecting-ip': '10.0.0.5' } })
        const res = await app.request(`/cache/v1/${'f'.repeat(64)}`, init, await makeWriteEnv())
        expect(res.status).toBe(400)
        expect(await res.text()).toContain('does not match')
    })

    it('rejects a malformed repo URL or head commit', async () => {
        const badUrl = await makePut({
            repoUrl: 'https://example.com/a/b',
            headers: { 'cf-connecting-ip': '10.0.0.6' },
        })
        const urlRes = await app.request(`/cache/v1/${badUrl.hash}`, badUrl.init, await makeWriteEnv())
        expect(urlRes.status).toBe(400)

        const badCommit = await makePut({ headers: { 'x-head-commit': 'nope', 'cf-connecting-ip': '10.0.0.6' } })
        const commitRes = await app.request(`/cache/v1/${badCommit.hash}`, badCommit.init, await makeWriteEnv())
        expect(commitRes.status).toBe(400)
    })

    it('rejects when Content-Length is over 10 MB', async () => {
        const { hash, init } = await makePut({
            headers: { 'content-length': '20000000', 'cf-connecting-ip': '10.0.0.7' },
        })
        const res = await app.request(`/cache/v1/${hash}`, init, await makeWriteEnv())
        expect(res.status).toBe(413)
    })

    it('rejects a body that streams past 10 MB', async () => {
        const bucket = mockR2Bucket()
        const { hash, init } = await makePut({
            body: new Uint8Array(10 * 1024 * 1024 + 1),
            headers: { 'content-length': '100', 'cf-connecting-ip': '10.0.0.8' },
        })
        const res = await app.request(`/cache/v1/${hash}`, init, await makeWriteEnv(bucket))
        expect(res.status).toBe(413)
        expect(bucket.put).not.toHaveBeenCalled()
    })

    it('rejects when verifyHeadCommit fails', async () => {
        vi.mocked(verifyHeadCommit).mockResolvedValue('Failed to verify headCommit: not found.')
        const bucket = mockR2Bucket()
        const { hash, init } = await makePut({ headers: { 'cf-connecting-ip': '10.0.0.9' } })
        const res = await app.request(`/cache/v1/${hash}`, init, await makeWriteEnv(bucket))
        expect(res.status).toBe(400)
        expect(bucket.put).not.toHaveBeenCalled()
    })

    it('enforces write rate limit', async () => {
        const env = await makeWriteEnv()
        const results = []
        for (let i = 0; i < 11; i++) {
            const { hash, init } = await makePut({ headers: { 'cf-connecting-ip': '10.0.0.99' } })
            const res = await app.request(`/cache/v1/${hash}`, init, env)
            results.push(res.status)
        }
        expect(results.slice(0, 10).every((s) => s === 200)).toBe(true)
        expect(results[10]).toBe(429)
    })
})

describe('CORS preflight', () => {
    it('allows the cache upload headers and PUT', async () => {
        const res = await app.request('/cache/v1/x', { method: 'OPTIONS' }, {})
        const allowed = (res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase()
        for (const header of ['authorization', 'x-repo-url', 'x-head-commit', 'content-encoding', 'content-type']) {
            expect(allowed).toContain(header)
        }
        expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT')
    })
})

// --- Proxy passthrough auth ---

const noopExecutionCtx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} }

describe('proxy passthrough auth', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('forwards Authorization upstream and does not cache authed /info/refs', async () => {
        const putSpy = vi.fn(async () => {})
        vi.stubGlobal('caches', { default: { match: vi.fn(async () => undefined), put: putSpy } })
        let capturedHeaders: Headers | undefined
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: string, init: RequestInit) => {
                capturedHeaders = new Headers(init.headers)
                return new Response('refs', { status: 200 })
            }),
        )

        const res = await app.request(
            '/github.com/owner/repo.git/info/refs?service=git-upload-pack',
            { method: 'GET', headers: { authorization: 'Bearer secret-token', accept: '*/*' } },
            {},
            noopExecutionCtx,
        )

        expect(res.status).toBe(200)
        expect(res.headers.get('X-Cache')).toBe('NONE')
        expect(putSpy).not.toHaveBeenCalled()
        expect(capturedHeaders?.get('authorization')).toBe('Bearer secret-token')
    })

    it('caches unauthenticated /info/refs and omits Authorization upstream', async () => {
        const putSpy = vi.fn(async () => {})
        vi.stubGlobal('caches', { default: { match: vi.fn(async () => undefined), put: putSpy } })
        let capturedHeaders: Headers | undefined
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: string, init: RequestInit) => {
                capturedHeaders = new Headers(init.headers)
                return new Response('refs', { status: 200 })
            }),
        )

        const res = await app.request(
            '/github.com/owner/repo.git/info/refs?service=git-upload-pack',
            { method: 'GET', headers: { accept: '*/*' } },
            {},
            noopExecutionCtx,
        )

        expect(res.headers.get('X-Cache')).toBe('MISS')
        expect(putSpy).toHaveBeenCalled()
        expect(capturedHeaders?.get('authorization')).toBeNull()
    })
})
