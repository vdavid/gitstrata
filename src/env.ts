import { defineEnvVars } from '@sveltejs/kit/env'

// The site is fully prerendered and CI sets these at build time, so they're all static (inlined into the bundle).
// Every one is optional: an unset or empty value reads as `undefined`, and each consumer falls back or no-ops.
const optionalPublic = (description: string) =>
    ({ public: true, static: true, description, schema: (value: string | undefined) => value || undefined }) as const

export const variables = defineEnvVars({
    PUBLIC_CORS_PROXY_URL: optionalPublic('CORS proxy for git requests. Falls back to the shared public proxy.'),
    PUBLIC_SHARED_CACHE_URL: optionalPublic('Shared results cache endpoint. Unset disables the shared cache.'),
    PUBLIC_ANALYTICS_ID: optionalPublic('Umami website ID. Unset disables analytics.'),
})
