// The shared public proxy. When the app runs against this default, we don't offer private-repo
// auth — a token must never transit a third party. A configured PUBLIC_CORS_PROXY_URL means the
// deployment runs its own proxy, where forwarding the token is safe.
export const publicProxyUrl = 'https://cors.isomorphic-git.org'

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

/** Whether the configured CORS proxy is self-hosted (not the shared public default). */
export const isSelfHostedProxy = (corsProxy: string): boolean => stripTrailingSlash(corsProxy) !== publicProxyUrl
