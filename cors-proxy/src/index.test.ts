import { describe, it, expect, vi } from 'vitest'
import app from './index'

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

function mockR2Bucket(store: Map<string, ArrayBuffer> = new Map()) {
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
        put: vi.fn(async (key: string, value: ArrayBuffer) => {
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

describe('PUT /cache/v1/:repoHash', () => {
    it('returns 404 when R2 binding is missing', async () => {
        const res = await app.request('/cache/v1/somehash', { method: 'PUT', body: 'data' }, {})
        expect(res.status).toBe(404)
    })

    it('rejects body larger than 10 MB', async () => {
        const bucket = mockR2Bucket()
        const bigBody = new Uint8Array(10 * 1024 * 1024 + 1)
        const res = await app.request('/cache/v1/somehash', { method: 'PUT', body: bigBody }, { RESULTS: bucket })
        expect(res.status).toBe(413)
    })

    it('rejects early when Content-Length exceeds limit', async () => {
        const bucket = mockR2Bucket()
        const res = await app.request(
            '/cache/v1/somehash',
            {
                method: 'PUT',
                body: new Uint8Array(1),
                headers: { 'content-length': '20000000' },
            },
            { RESULTS: bucket },
        )
        expect(res.status).toBe(413)
        expect(await res.text()).toContain('Max 10 MB')
    })

    it('rejects decompressed payload that exceeds 50 MB', async () => {
        const bucket = mockR2Bucket()
        // Highly compressible string: gzips to a few KB, decompresses to ~60 MB
        const huge = 'a'.repeat(60 * 1024 * 1024)
        const compressed = await gzip(huge)
        const res = await app.request('/cache/v1/somehash', { method: 'PUT', body: compressed }, { RESULTS: bucket })
        expect(res.status).toBe(413)
        expect(await res.text()).toContain('Decompressed payload too large')
    })

    it('rejects invalid gzip payload', async () => {
        const bucket = mockR2Bucket()
        const res = await app.request(
            '/cache/v1/somehash',
            {
                method: 'PUT',
                body: new Uint8Array([1, 2, 3]),
            },
            { RESULTS: bucket },
        )
        expect(res.status).toBe(400)
        expect(await res.text()).toContain('Invalid gzip or JSON')
    })

    it('rejects invalid JSON shape', async () => {
        const bucket = mockR2Bucket()
        const compressed = await gzip(JSON.stringify({ wrong: 'shape' }))
        const res = await app.request(
            '/cache/v1/somehash',
            {
                method: 'PUT',
                body: compressed,
            },
            { RESULTS: bucket },
        )
        expect(res.status).toBe(400)
        expect(await res.text()).toContain('version must be 1')
    })

    it('rejects hash mismatch', async () => {
        const bucket = mockR2Bucket()
        const entry = makeEntry()
        const compressed = await gzip(JSON.stringify(entry))
        const res = await app.request(
            '/cache/v1/wronghash',
            {
                method: 'PUT',
                body: compressed,
            },
            { RESULTS: bucket },
        )
        expect(res.status).toBe(400)
        expect(await res.text()).toContain('repoUrl hash does not match')
    })

    it('stores valid entry and returns 200', async () => {
        const store = new Map<string, ArrayBuffer>()
        const bucket = mockR2Bucket(store)
        const entry = makeEntry()
        const hash = await sha256Hex(entry.repoUrl)
        const compressed = await gzip(JSON.stringify(entry))

        const res = await app.request(
            `/cache/v1/${hash}`,
            {
                method: 'PUT',
                body: compressed,
            },
            { RESULTS: bucket },
        )

        expect(res.status).toBe(200)
        expect(await res.text()).toBe('Stored')
        expect(bucket.put).toHaveBeenCalledWith(
            `results/v1/${hash}.json.gz`,
            expect.any(ArrayBuffer),
            expect.objectContaining({
                httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
            }),
        )
    })

    it('enforces write rate limit', async () => {
        const bucket = mockR2Bucket()
        const entry = makeEntry('https://github.com/ratelimit/test')
        const hash = await sha256Hex(entry.repoUrl)
        const compressed = await gzip(JSON.stringify(entry))

        // Send 11 requests with the same IP to exceed 10/min write limit
        const results = []
        for (let i = 0; i < 11; i++) {
            const res = await app.request(
                `/cache/v1/${hash}`,
                {
                    method: 'PUT',
                    body: compressed,
                    headers: { 'cf-connecting-ip': '10.0.0.99' },
                },
                { RESULTS: bucket },
            )
            results.push(res.status)
        }

        // First 10 should succeed, 11th should be rate limited
        expect(results.slice(0, 10).every((s) => s === 200)).toBe(true)
        expect(results[10]).toBe(429)
    })
})
