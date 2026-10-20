import type { Reroute } from '@sveltejs/kit/hooks'

/**
 * Route all paths to the root page — repo is read from the pathname client-side.
 * SvelteKit's own `/_app/` paths (like `/_app/env.js`) are matched after rerouting, so they must pass through.
 */
export const reroute: Reroute = ({ url }) => {
    if (url.pathname !== '/' && !url.pathname.startsWith('/_app/')) {
        return '/'
    }
}
