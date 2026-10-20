import { describe, expect, it } from 'vitest'
import { reroute } from '../src/hooks.js'

const rerouteFor = (pathname: string) => reroute({ url: new URL(`http://localhost${pathname}`), fetch })

describe('reroute', () => {
    it('sends repo paths to the root page', () => {
        expect(rerouteFor('/github.com/sveltejs/kit')).toBe('/')
    })

    it('leaves the root page alone', () => {
        expect(rerouteFor('/')).toBeUndefined()
    })

    // Regression: SvelteKit 3 matches `/_app/env.js` against the rerouted path, so rerouting it served the page HTML
    // and the dev client failed with "Failed to fetch dynamically imported module".
    it("leaves SvelteKit's own `/_app/` paths alone", () => {
        expect(rerouteFor('/_app/env.js')).toBeUndefined()
        expect(rerouteFor('/_app/version.json')).toBeUndefined()
    })
})
