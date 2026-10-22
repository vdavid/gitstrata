import { describe, it, expect, vi, afterEach } from 'vitest'
import { trackEvent, repoLabel } from '../src/lib/analytics'

describe('trackEvent', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('forwards the event to Umami when it is loaded', () => {
        const track = vi.fn()
        vi.stubGlobal('window', { umami: { track } })
        trackEvent('cache-hit', { repo: 'owner/repo', source: 'local' })
        expect(track).toHaveBeenCalledWith('cache-hit', { repo: 'owner/repo', source: 'local' })
    })

    it('sends events without props', () => {
        const track = vi.fn()
        vi.stubGlobal('window', { umami: { track } })
        trackEvent('write-key-adopted')
        expect(track).toHaveBeenCalledWith('write-key-adopted', undefined)
    })

    it('does nothing when Umami is absent', () => {
        vi.stubGlobal('window', {})
        expect(() => trackEvent('analysis-cancel', { repo: 'owner/repo' })).not.toThrow()
    })

    it('never throws when Umami throws', () => {
        vi.stubGlobal('window', {
            umami: {
                track: () => {
                    throw new Error('blocked')
                },
            },
        })
        expect(() => trackEvent('size-gate', { repo: 'owner/repo' })).not.toThrow()
    })
})

describe('repoLabel', () => {
    it('uses owner/repo for GitHub', () => {
        expect(repoLabel('https://github.com/sveltejs/svelte')).toBe('sveltejs/svelte')
    })

    it('keeps the host for other forges', () => {
        expect(repoLabel('https://gitlab.com/gitlab-org/gitlab')).toBe('gitlab.com/gitlab-org/gitlab')
    })

    it('falls back to an empty string for unparsable input', () => {
        expect(repoLabel('')).toBe('')
    })
})
