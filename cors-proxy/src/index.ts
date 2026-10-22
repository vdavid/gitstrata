import { Hono } from 'hono'
import {
    isValidCommit,
    isValidRepoUrl,
    isValidWriteKey,
    parseKeyHashes,
    readBodyWithLimit,
    sha256Hex,
} from './cache-write-checks'
import { isOriginAllowed, parseAllowedOrigins } from './allowed-origins'
import { verifyHeadCommit } from './verify-head-commit'

type Bindings = {
    RESULTS?: R2Bucket
    WRITE_KEY_HASHES?: string
    /** Comma-separated origin allowlist (see `allowed-origins.ts`). Unset or empty allows any origin. */
    ALLOWED_ORIGINS?: string
}

type RequestContext = { env: Bindings; req: { header: (name: string) => string | undefined } }

const app = new Hono<{ Bindings: Bindings }>()

/** True when the request carries an `Origin` header that the allowlist rejects. */
function hasDisallowedOrigin(c: RequestContext): boolean {
    const origin = c.req.header('origin')
    const rules = parseAllowedOrigins(c.env.ALLOWED_ORIGINS)
    return origin !== undefined && rules !== null && !isOriginAllowed(origin, rules)
}

function getCorsHeaders(c: RequestContext): Record<string, string> {
    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers':
            'Content-Type, Content-Encoding, Git-Protocol, Authorization, X-Repo-Url, X-Head-Commit',
        'Access-Control-Expose-Headers': 'Content-Type, Content-Length',
    }
    const rules = parseAllowedOrigins(c.env.ALLOWED_ORIGINS)
    if (rules === null) {
        // No allowlist configured (local dev): any origin.
        headers['Access-Control-Allow-Origin'] = '*'
        return headers
    }
    // The response depends on the request's Origin, so caches must key on it.
    headers['Vary'] = 'Origin'
    const origin = c.req.header('origin')
    if (origin !== undefined && isOriginAllowed(origin, rules)) {
        headers['Access-Control-Allow-Origin'] = origin
    }
    return headers
}

type RateLimitEntry = { count: number; resetAt: number }
const rateLimitMap = new Map<string, RateLimitEntry>()
const maxRequestsPerMinute = 100
const writeRateLimitMap = new Map<string, RateLimitEntry>()
const maxWritesPerMinute = 10
const maxRateLimitEntries = 10_000

/** Remove expired entries from a rate limit map to prevent unbounded growth. */
function evictExpired(map: Map<string, RateLimitEntry>, now: number): void {
    if (map.size <= maxRateLimitEntries) return
    for (const [key, entry] of map) {
        if (now >= entry.resetAt) map.delete(key)
    }
}

function checkRateLimit(map: Map<string, RateLimitEntry>, ip: string, limit: number): boolean {
    const now = Date.now()
    const entry = map.get(ip)

    if (!entry || now >= entry.resetAt) {
        map.set(ip, { count: 1, resetAt: now + 60_000 })
        evictExpired(map, now)
        return false
    }

    entry.count++
    return entry.count > limit
}

function isRateLimited(ip: string): boolean {
    return checkRateLimit(rateLimitMap, ip, maxRequestsPerMinute)
}

function isWriteRateLimited(ip: string): boolean {
    return checkRateLimit(writeRateLimitMap, ip, maxWritesPerMinute)
}

const allowedHosts = new Set(['github.com', 'gitlab.com', 'bitbucket.org'])

function isAllowedTarget(url: string): boolean {
    try {
        const parsed = new URL(url)
        if (!allowedHosts.has(parsed.hostname)) return false
        return parsed.pathname.endsWith('/info/refs') || parsed.pathname.endsWith('/git-upload-pack')
    } catch {
        return false
    }
}

const maxBodySize = 10 * 1024 * 1024 // 10 MB

// Browsers enforce CORS only on reading the response, so a disallowed site could still make the proxy do the work
// (fetch upstream, write the cache). Refuse it outright. Preflights pass through and get no ACAO header instead.
// Requests without an Origin (curl, server-to-server) aren't affected.
app.use('*', async (c, next) => {
    if (c.req.method !== 'OPTIONS' && hasDisallowedOrigin(c)) {
        return c.text('Forbidden origin.', 403, getCorsHeaders(c))
    }
    await next()
})

// --- Cache routes (only active when R2 binding RESULTS is present) ---

app.get('/cache/v1/:repoHash', async (c) => {
    const bucket = c.env.RESULTS
    if (!bucket) {
        return c.text('Not found', 404, getCorsHeaders(c))
    }

    const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
    if (isRateLimited(ip)) {
        return c.text('Rate limit exceeded. Max 100 requests per minute.', 429, getCorsHeaders(c))
    }

    const repoHash = c.req.param('repoHash')
    const object = await bucket.get(`results/v1/${repoHash}.json.gz`)

    if (!object) {
        return c.text('Not found', 404, getCorsHeaders(c))
    }

    const headers = new Headers(getCorsHeaders(c))
    headers.set('Content-Type', 'application/json')
    headers.set('Content-Encoding', 'gzip')
    headers.set('Cache-Control', 'public, max-age=300')

    return new Response(object.body, { status: 200, headers })
})

app.put('/cache/v1/:repoHash', async (c) => {
    const bucket = c.env.RESULTS
    if (!bucket) {
        return c.text('Not found', 404, getCorsHeaders(c))
    }

    const ip = c.req.header('cf-connecting-ip') ?? 'unknown'

    if (isRateLimited(ip)) {
        return c.text('Rate limit exceeded. Max 100 requests per minute.', 429, getCorsHeaders(c))
    }
    if (isWriteRateLimited(ip)) {
        return c.text('Write rate limit exceeded. Max 10 writes per minute.', 429, getCorsHeaders(c))
    }

    // Only holders of a personal write key may upload. No configured keys means no writes (fail closed).
    const keyHashes = parseKeyHashes(c.env.WRITE_KEY_HASHES)
    if (keyHashes.length === 0) {
        return c.text('Cache writes are disabled (no write keys configured).', 403, getCorsHeaders(c))
    }
    const key = (c.req.header('authorization') ?? '').match(/^Bearer (.+)$/)?.[1] ?? ''
    if (!(await isValidWriteKey(key, keyHashes))) {
        return c.text('Missing or invalid write key.', 403, getCorsHeaders(c))
    }

    // The body is never parsed: gunzip + JSON.parse of a multi-MB result doesn't fit the free plan's 10 ms CPU.
    // The client states what it's uploading in headers instead.
    const repoUrl = c.req.header('x-repo-url') ?? ''
    const headCommit = c.req.header('x-head-commit') ?? ''
    if (!isValidRepoUrl(repoUrl)) {
        return c.text(
            'X-Repo-Url must match https://(github.com|gitlab.com|bitbucket.org)/<owner>/<repo>.',
            400,
            getCorsHeaders(c),
        )
    }
    if (!isValidCommit(headCommit)) {
        return c.text('X-Head-Commit must be a 40-character lowercase hex string.', 400, getCorsHeaders(c))
    }

    const repoHash = c.req.param('repoHash')
    if ((await sha256Hex(repoUrl)) !== repoHash) {
        return c.text('X-Repo-Url hash does not match path.', 400, getCorsHeaders(c))
    }

    const contentLength = Number(c.req.header('content-length') ?? NaN)
    if (!Number.isInteger(contentLength) || contentLength < 0) {
        return c.text('Content-Length is required.', 411, getCorsHeaders(c))
    }
    if (contentLength > maxBodySize) {
        return c.text('Request body too large. Max 10 MB.', 413, getCorsHeaders(c))
    }

    const commitError = await verifyHeadCommit(repoUrl, headCommit)
    if (commitError) {
        return c.text(commitError, 400, getCorsHeaders(c))
    }

    // Content-Length can lie, so cap the stream too.
    const body = await readBodyWithLimit(c.req.raw.body, maxBodySize)
    if (!body) {
        return c.text('Request body too large. Max 10 MB.', 413, getCorsHeaders(c))
    }

    await bucket.put(`results/v1/${repoHash}.json.gz`, body, {
        httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
        customMetadata: { repoUrl, headCommit, updatedAt: new Date().toISOString() },
    })

    return c.text('Stored', 200, getCorsHeaders(c))
})

app.options('*', (c) => {
    return c.body(null, 204, getCorsHeaders(c))
})

app.all('*', async (c) => {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown'

    if (isRateLimited(ip)) {
        return c.text('Rate limit exceeded. Max 100 requests per minute.', 429, getCorsHeaders(c))
    }

    // The target URL is everything after the proxy host's `/`.
    // isomorphic-git strips the protocol (e.g. "https://") when using corsProxy,
    // so we re-add it when the path doesn't already include one.
    const rawPath = c.req.path.slice(1) + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '')
    const targetUrl = rawPath.startsWith('http') ? rawPath : `https://${rawPath}`

    if (!rawPath) {
        return c.text('Missing target URL. Pass the full URL as the path.', 400, getCorsHeaders(c))
    }

    if (!isAllowedTarget(targetUrl)) {
        return c.text('Forbidden. Only git protocol paths on allowed hosts are permitted.', 403, getCorsHeaders(c))
    }

    // Cache GET /info/refs requests using Cloudflare Cache API.
    // Only cache v1 responses (no Git-Protocol header). isomorphic-git uses v2 for
    // branch detection then v1 for clone — caching v2 would poison v1 lookups.
    const isInfoRefsGet = c.req.method === 'GET' && targetUrl.includes('/info/refs')
    const gitProtocol = c.req.header('git-protocol')
    // Never cache authenticated responses: the cache is keyed by URL only, so caching a
    // private repo's refs would leak them to the next requester of the same URL.
    const hasAuthHeader = Boolean(c.req.header('authorization'))
    const shouldCache = isInfoRefsGet && !gitProtocol && !hasAuthHeader

    if (shouldCache) {
        const cache = caches.default
        const cacheKey = new Request(targetUrl)
        const cachedResponse = await cache.match(cacheKey)

        if (cachedResponse) {
            const responseHeaders = new Headers(getCorsHeaders(c))
            for (const [key, value] of cachedResponse.headers.entries()) {
                const lower = key.toLowerCase()
                if (lower === 'content-type' || lower === 'content-length' || lower === 'content-encoding') {
                    responseHeaders.set(key, value)
                }
            }
            // Prevent browser from caching /info/refs (the proxy has its own cache).
            // Without this, the browser reuses a protocol-v2 response for a v1 request.
            responseHeaders.set('Cache-Control', 'no-store')
            responseHeaders.set('X-Cache', 'HIT')

            return new Response(cachedResponse.body, {
                status: cachedResponse.status,
                headers: responseHeaders,
            })
        }
    }

    const allowedRequestHeaders = new Set([
        'content-type',
        'content-length',
        'accept',
        'accept-encoding',
        'git-protocol',
        // Forwarded so private repos can authenticate. Only ever reaches the allowlisted
        // git hosts (github/gitlab/bitbucket). Authed responses are never cached (see above).
        'authorization',
    ])
    const headers = new Headers()
    for (const [key, value] of c.req.raw.headers.entries()) {
        if (allowedRequestHeaders.has(key.toLowerCase())) {
            headers.set(key, value)
        }
    }

    const contentLength = parseInt(c.req.header('content-length') ?? '0', 10)
    if (contentLength > maxBodySize) {
        return c.text('Request body too large. Max 10 MB.', 413, getCorsHeaders(c))
    }

    try {
        const response = await fetch(targetUrl, {
            method: c.req.method,
            headers,
            body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
            redirect: 'follow',
            signal: c.req.raw.signal,
        })

        const responseHeaders = new Headers(getCorsHeaders(c))
        for (const [key, value] of response.headers.entries()) {
            const lower = key.toLowerCase()
            // Pass through content headers (but not cache-control — see below)
            if (lower === 'content-type' || lower === 'content-length' || lower === 'content-encoding') {
                responseHeaders.set(key, value)
            } else if (lower === 'www-authenticate') {
                // Pass the auth challenge through so isomorphic-git retries the request with credentials.
                responseHeaders.set(key, value)
            } else if (lower === 'cache-control' && !isInfoRefsGet) {
                responseHeaders.set(key, value)
            }
        }
        // For /info/refs: prevent browser caching — the proxy has its own internal cache,
        // and browser caching causes v2 responses to be reused for v1 requests.
        if (isInfoRefsGet) {
            responseHeaders.set('Cache-Control', 'no-store')
        }

        // Cache /info/refs GET responses with 12-hour TTL (v1 only)
        if (shouldCache && response.ok) {
            const cache = caches.default
            const cacheKey = new Request(targetUrl)
            const cacheHeaders = new Headers(responseHeaders)
            cacheHeaders.set('Cache-Control', 'public, max-age=300')
            const cacheResponse = new Response(response.clone().body, {
                status: response.status,
                headers: cacheHeaders,
            })
            c.executionCtx.waitUntil(cache.put(cacheKey, cacheResponse))
        }

        responseHeaders.set('X-Cache', shouldCache ? 'MISS' : 'NONE')

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
        })
    } catch (error) {
        // A configured origin allowlist marks production: hide upstream error details there.
        if (parseAllowedOrigins(c.env.ALLOWED_ORIGINS) !== null) {
            return c.text('Unknown error', 502, getCorsHeaders(c))
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        return c.text(`Error (in prod, this would be an "Unknown error"): ${message}`, 502, getCorsHeaders(c))
    }
})

export default app
