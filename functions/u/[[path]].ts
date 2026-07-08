// Same-origin proxy for the Umami analytics tracker.
//
// Loading the tracker first-party under `/u/*` keeps it off adblock blocklists, which flag both
// third-party analytics domains and the well-known `/script.js` filename — a directly-loaded
// tracker gets blocked and most visitors go uncounted. `/u/mami` maps to the analytics host's
// `/script.js` (the only path Umami serves the tracker at); the tracker derives its beacon
// endpoint from its own directory, so it posts to `/u/api/send`, which maps straight through to
// the host's `/api/send`.
//
// The upstream host defaults to git strata's own Umami instance; self-hosters override it with the
// `ANALYTICS_UPSTREAM` environment variable on the Pages project (see docs/deploying.md).

interface Env {
    ANALYTICS_UPSTREAM?: string
}

const defaultUpstream = 'https://anal.veszelovszki.com'

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
    const upstream = (context.env.ANALYTICS_UPSTREAM ?? defaultUpstream).replace(/\/+$/, '')
    const requestUrl = new URL(context.request.url)
    const subPath = requestUrl.pathname.replace(/^\/u\//, '')
    const upstreamPath = subPath === 'mami' ? 'script.js' : subPath
    const targetUrl = `${upstream}/${upstreamPath}${requestUrl.search}`

    const headers = new Headers(context.request.headers)
    headers.delete('host')
    const clientIp = context.request.headers.get('cf-connecting-ip')
    if (clientIp) {
        // Preserve the real visitor IP so Umami counts uniques correctly instead of seeing the proxy.
        headers.set('x-forwarded-for', clientIp)
    }

    const method = context.request.method
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const upstreamResponse = await fetch(targetUrl, {
        method,
        headers,
        body: hasBody ? await context.request.arrayBuffer() : undefined,
    })

    const responseHeaders = new Headers(upstreamResponse.headers)
    // The tracker script is safe to cache briefly; the beacon must never be cached.
    responseHeaders.set('cache-control', upstreamPath === 'script.js' ? 'public, max-age=3600' : 'no-store')

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
    })
}
