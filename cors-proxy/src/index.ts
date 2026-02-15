import { Hono } from 'hono';

const app = new Hono();

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Git-Protocol, Authorization',
	'Access-Control-Expose-Headers': 'Content-Type, Content-Length'
};

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const maxRequestsPerMinute = 100;

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const entry = rateLimitMap.get(ip);

	if (!entry || now >= entry.resetAt) {
		rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
		return false;
	}

	entry.count++;
	return entry.count > maxRequestsPerMinute;
}

function isAllowedGitPath(url: string): boolean {
	return url.includes('/info/refs') || url.includes('/git-upload-pack');
}

app.options('*', (c) => {
	return c.body(null, 204, corsHeaders);
});

app.all('*', async (c) => {
	const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';

	if (isRateLimited(ip)) {
		return c.text('Rate limit exceeded. Max 100 requests per minute.', 429, corsHeaders);
	}

	// The target URL is everything after the proxy host's `/`
	const targetUrl =
		c.req.path.slice(1) + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '');

	if (!targetUrl || !targetUrl.startsWith('http')) {
		return c.text(
			'Missing or invalid target URL. Pass the full URL as the path.',
			400,
			corsHeaders
		);
	}

	if (!isAllowedGitPath(targetUrl)) {
		return c.text(
			'Forbidden. Only git protocol paths (/info/refs, /git-upload-pack) are allowed.',
			403,
			corsHeaders
		);
	}

	// Cache GET /info/refs requests using Cloudflare Cache API
	const isInfoRefsGet = c.req.method === 'GET' && targetUrl.includes('/info/refs');

	if (isInfoRefsGet) {
		const cache = caches.default;
		const cacheKey = new Request(targetUrl);
		const cachedResponse = await cache.match(cacheKey);

		if (cachedResponse) {
			const responseHeaders = new Headers(corsHeaders);
			for (const [key, value] of cachedResponse.headers.entries()) {
				const lower = key.toLowerCase();
				if (
					lower === 'content-type' ||
					lower === 'content-length' ||
					lower === 'content-encoding' ||
					lower === 'cache-control'
				) {
					responseHeaders.set(key, value);
				}
			}
			responseHeaders.set('X-Cache', 'HIT');

			return new Response(cachedResponse.body, {
				status: cachedResponse.status,
				headers: responseHeaders
			});
		}
	}

	const headers = new Headers();
	for (const [key, value] of c.req.raw.headers.entries()) {
		// Forward relevant headers, skip hop-by-hop and host headers
		const lower = key.toLowerCase();
		if (
			lower === 'host' ||
			lower === 'cf-connecting-ip' ||
			lower === 'cf-ray' ||
			lower.startsWith('cf-')
		)
			continue;
		headers.set(key, value);
	}

	try {
		const response = await fetch(targetUrl, {
			method: c.req.method,
			headers,
			body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
			// @ts-expect-error Cloudflare-specific option to disable following redirects
			redirect: 'follow'
		});

		const responseHeaders = new Headers(corsHeaders);
		for (const [key, value] of response.headers.entries()) {
			const lower = key.toLowerCase();
			// Pass through content headers
			if (
				lower === 'content-type' ||
				lower === 'content-length' ||
				lower === 'content-encoding' ||
				lower === 'cache-control'
			) {
				responseHeaders.set(key, value);
			}
		}

		// Cache /info/refs GET responses with 12-hour TTL
		if (isInfoRefsGet && response.ok) {
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

		responseHeaders.set('X-Cache', isInfoRefsGet ? 'MISS' : 'NONE');

		return new Response(response.body, {
			status: response.status,
			headers: responseHeaders
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return c.text(`Failed to fetch target URL: ${message}`, 502, corsHeaders);
	}
});

export default app;
