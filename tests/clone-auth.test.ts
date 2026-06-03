import { describe, it, expect } from 'vitest'
import { makeOnAuth } from '../src/lib/git/clone'

describe('makeOnAuth', () => {
    it('returns no callback when there is no token, so a 401 surfaces as an auth error', () => {
        // Attaching a cancel-callback here would make isomorphic-git throw a cancellation,
        // which we'd mis-report as "Analysis cancelled" instead of the private-repo prompt.
        expect(makeOnAuth(undefined)).toBeUndefined()
    })

    it('returns a callback yielding Basic-auth credentials when a token is present', () => {
        const onAuth = makeOnAuth('github_pat_secret')
        expect(onAuth).toBeTypeOf('function')
        expect(onAuth?.()).toEqual({ username: 'github_pat_secret', password: 'x-oauth-basic' })
    })
})
