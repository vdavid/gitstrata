import { Hono } from 'hono';

type Bindings = {
	RESULTS?: R2Bucket;
	CACHE_WRITE_TOKEN?: string;
	ALLOWED_ORIGIN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

function getCorsHeaders(c: {
	env: Bindings;
	req: { header: (name: string) => string | undefined };
}) {
	const allowed = c.env.ALLOWED_ORIGIN;
	const origin = c.req.header('origin');
	// When ALLOWED_ORIGIN is set, only reflect it if the request origin matches.
	// When unset (local dev), allow any origin.
	const allowOrigin = !allowed ? '*' : origin === allowed ? allowed : 'null';
	return {
		'Access-Control-Allow-Origin': allowOrigin,
		'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Git-Protocol, Authorization',
		'Access-Control-Expose-Headers': 'Content-Type, Content-Length'
	};
}

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateLimitEntry>();
const maxRequestsPerMinute = 100;
const writeRateLimitMap = new Map<string, RateLimitEntry>();
const maxWritesPerMinute = 10;
const maxRateLimitEntries = 10_000;

/** Remove expired entries from a rate limit map to prevent unbounded growth. */
function evictExpired(map: Map<string, RateLimitEntry>, now: number): void {
	if (map.size <= maxRateLimitEntries) return;
	for (const [key, entry] of map) {
		if (now >= entry.resetAt) map.delete(key);
	}
}

function checkRateLimit(map: Map<string, RateLimitEntry>, ip: string, limit: number): boolean {
	const now = Date.now();
	const entry = map.get(ip);

	if (!entry || now >= entry.resetAt) {
		map.set(ip, { count: 1, resetAt: now + 60_000 });
		evictExpired(map, now);
		return false;
	}

	entry.count++;
	return entry.count > limit;
}

function isRateLimited(ip: string): boolean {
	return checkRateLimit(rateLimitMap, ip, maxRequestsPerMinute);
}

function isWriteRateLimited(ip: string): boolean {
	return checkRateLimit(writeRateLimitMap, ip, maxWritesPerMinute);
}

const allowedHosts = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

function isAllowedTarget(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (!allowedHosts.has(parsed.hostname)) return false;
		return parsed.pathname.endsWith('/info/refs') || parsed.pathname.endsWith('/git-upload-pack');
	} catch {
		return false;
	}
}

async function sha256Hex(input: string): Promise<string> {
	const encoded = new TextEncoder().encode(input);
	const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
	return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const maxBodySize = 10 * 1024 * 1024; // 10 MB
const maxDecompressedSize = 50 * 1024 * 1024; // 50 MB — guards against gzip bombs

function isValidCacheEntry(data: unknown): data is {
	version: 1;
	repoUrl: string;
	headCommit: string;
	result: { days: unknown[] };
	updatedAt: string;
} {
	if (typeof data !== 'object' || data === null) return false;
	const obj = data as Record<string, unknown>;
	if (obj.version !== 1) return false;
	if (typeof obj.repoUrl !== 'string') return false;
	if (typeof obj.headCommit !== 'string') return false;
	if (typeof obj.updatedAt !== 'string') return false;
	if (typeof obj.result !== 'object' || obj.result === null) return false;
	const result = obj.result as Record<string, unknown>;
	return Array.isArray(result.days);
}

// --- Cache routes (only active when R2 binding RESULTS is present) ---

app.get('/cache/v1/:repoHash', async (c) => {
	const bucket = c.env.RESULTS;
	if (!bucket) {
		return c.text('Not found', 404, getCorsHeaders(c));
	}

	const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
	if (isRateLimited(ip)) {
		return c.text('Rate limit exceeded. Max 100 requests per minute.', 429, getCorsHeaders(c));
	}

	const repoHash = c.req.param('repoHash');
	const object = await bucket.get(`results/v1/${repoHash}.json.gz`);

	if (!object) {
		return c.text('Not found', 404, getCorsHeaders(c));
	}

	const headers = new Headers(getCorsHeaders(c));
	headers.set('Content-Type', 'application/json');
	headers.set('Content-Encoding', 'gzip');
	headers.set('Cache-Control', 'public, max-age=300');

	return new Response(object.body, { status: 200, headers });
});

app.put('/cache/v1/:repoHash', async (c) => {
	const bucket = c.env.RESULTS;
	if (!bucket) {
		return c.text('Not found', 404, getCorsHeaders(c));
	}

	const writeToken = c.env.CACHE_WRITE_TOKEN;
	if (writeToken) {
		const auth = c.req.header('authorization');
		if (auth !== `Bearer ${writeToken}`) {
			return c.text('Unauthorized', 401, getCorsHeaders(c));
		}
	}

	const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';

	if (isRateLimited(ip)) {
		return c.text('Rate limit exceeded. Max 100 requests per minute.', 429, getCorsHeaders(c));
	}
	if (isWriteRateLimited(ip)) {
		return c.text('Write rate limit exceeded. Max 10 writes per minute.', 429, getCorsHeaders(c));
	}

	// Reject oversized payloads before buffering the body
	const contentLength = parseInt(c.req.header('content-length') ?? '', 10);
	if (contentLength > maxBodySize) {
		return c.text('Request body too large. Max 10 MB.', 413, getCorsHeaders(c));
	}

	const body = await c.req.arrayBuffer();
	if (body.byteLength > maxBodySize) {
		return c.text('Request body too large. Max 10 MB.', 413, getCorsHeaders(c));
	}

	// Decompress gzip with a size limit to guard against gzip bombs
	const decompressedStream = new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'));
	const reader = decompressedStream.getReader();
	const chunks: Uint8Array[] = [];
	let totalDecompressedSize = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			totalDecompressedSize += value.byteLength;
			if (totalDecompressedSize > maxDecompressedSize) {
				reader.cancel();
				return c.text('Decompressed payload too large. Max 50 MB.', 413, getCorsHeaders(c));
			}
			chunks.push(value);
		}
	} catch {
		return c.text('Invalid gzip or JSON payload.', 400, getCorsHeaders(c));
	}

	let parsed: unknown;
	try {
		const text = await new Blob(chunks).text();
		parsed = JSON.parse(text);
	} catch {
		return c.text('Invalid gzip or JSON payload.', 400, getCorsHeaders(c));
	}

	if (!isValidCacheEntry(parsed)) {
		return c.text('Invalid cache entry shape.', 400, getCorsHeaders(c));
	}

	const repoHash = c.req.param('repoHash');
	const expectedHash = await sha256Hex(parsed.repoUrl);
	if (expectedHash !== repoHash) {
		return c.text('repoUrl hash does not match path.', 400, getCorsHeaders(c));
	}

	await bucket.put(`results/v1/${repoHash}.json.gz`, body, {
		httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' }
	});

	return c.text('Stored', 200, getCorsHeaders(c));
});

app.options('*', (c) => {
	return c.body(null, 204, getCorsHeaders(c));
});

app.all('*', async (c) => {
	const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';

	if (isRateLimited(ip)) {
		return c.text('Rate limit exceeded. Max 100 requests per minute.', 429, getCorsHeaders(c));
	}

	// The target URL is everything after the proxy host's `/`.
	// isomorphic-git strips the protocol (e.g. "https://") when using corsProxy,
	// so we re-add it when the path doesn't already include one.
	const rawPath =
		c.req.path.slice(1) + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '');
	const targetUrl = rawPath.startsWith('http') ? rawPath : `https://${rawPath}`;

	if (!rawPath) {
		return c.text('Missing target URL. Pass the full URL as the path.', 400, getCorsHeaders(c));
	}

	if (!isAllowedTarget(targetUrl)) {
		return c.text(
			'Forbidden. Only git protocol paths on allowed hosts are permitted.',
			403,
			getCorsHeaders(c)
		);
	}

	// Cache GET /info/refs requests using Cloudflare Cache API.
	// Only cache v1 responses (no Git-Protocol header). isomorphic-git uses v2 for
	// branch detection then v1 for clone — caching v2 would poison v1 lookups.
	const isInfoRefsGet = c.req.method === 'GET' && targetUrl.includes('/info/refs');
	const gitProtocol = c.req.header('git-protocol');
	const shouldCache = isInfoRefsGet && !gitProtocol;

	if (shouldCache) {
		const cache = caches.default;
		const cacheKey = new Request(targetUrl);
		const cachedResponse = await cache.match(cacheKey);

		if (cachedResponse) {
			const responseHeaders = new Headers(getCorsHeaders(c));
			for (const [key, value] of cachedResponse.headers.entries()) {
				const lower = key.toLowerCase();
				if (
					lower === 'content-type' ||
					lower === 'content-length' ||
					lower === 'content-encoding'
				) {
					responseHeaders.set(key, value);
				}
			}
			// Prevent browser from caching /info/refs (the proxy has its own cache).
			// Without this, the browser reuses a protocol-v2 response for a v1 request.
			responseHeaders.set('Cache-Control', 'no-store');
			responseHeaders.set('X-Cache', 'HIT');

			return new Response(cachedResponse.body, {
				status: cachedResponse.status,
				headers: responseHeaders
			});
		}
	}

	const allowedRequestHeaders = new Set([
		'content-type',
		'content-length',
		'accept',
		'accept-encoding',
		'git-protocol'
	]);
	const headers = new Headers();
	for (const [key, value] of c.req.raw.headers.entries()) {
		if (allowedRequestHeaders.has(key.toLowerCase())) {
			headers.set(key, value);
		}
	}

	try {
		const response = await fetch(targetUrl, {
			method: c.req.method,
			headers,
			body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
			redirect: 'follow'
		});

		const responseHeaders = new Headers(getCorsHeaders(c));
		for (const [key, value] of response.headers.entries()) {
			const lower = key.toLowerCase();
			// Pass through content headers (but not cache-control — see below)
			if (lower === 'content-type' || lower === 'content-length' || lower === 'content-encoding') {
				responseHeaders.set(key, value);
			} else if (lower === 'cache-control' && !isInfoRefsGet) {
				responseHeaders.set(key, value);
			}
		}
		// For /info/refs: prevent browser caching — the proxy has its own internal cache,
		// and browser caching causes v2 responses to be reused for v1 requests.
		if (isInfoRefsGet) {
			responseHeaders.set('Cache-Control', 'no-store');
		}

		// Cache /info/refs GET responses with 12-hour TTL (v1 only)
		if (shouldCache && response.ok) {
			const cache = caches.default;
			const cacheKey = new Request(targetUrl);
			const cacheHeaders = new Headers(responseHeaders);
			cacheHeaders.set('Cache-Control', 'public, max-age=43200');
			const cacheResponse = new Response(response.clone().body, {
				status: response.status,
				headers: cacheHeaders
			});
			c.executionCtx.waitUntil(cache.put(cacheKey, cacheResponse));
		}

		responseHeaders.set('X-Cache', shouldCache ? 'MISS' : 'NONE');

		return new Response(response.body, {
			status: response.status,
			headers: responseHeaders
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return c.text(`Failed to fetch target URL: ${message}`, 502, getCorsHeaders(c));
	}
});

export default app;
