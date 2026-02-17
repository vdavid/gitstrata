import type { Reroute } from '@sveltejs/kit'

/** Route all paths to the root page — repo is read from the pathname client-side. */
export const reroute: Reroute = ({ url }) => {
    if (url.pathname !== '/') {
        return '/'
    }
}
