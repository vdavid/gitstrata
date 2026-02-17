import { describe, it, expect } from 'vitest'
import { parseRepoUrl, parseRepoFromPathname, repoToDir } from '$lib/url'

describe('parseRepoUrl', () => {
    it('parses full GitHub HTTPS URL', () => {
        const result = parseRepoUrl('https://github.com/sveltejs/svelte')
        expect(result.url).toBe('https://github.com/sveltejs/svelte')
        expect(result.host).toBe('github.com')
        expect(result.owner).toBe('sveltejs')
        expect(result.repo).toBe('svelte')
    })

    it('strips .git suffix', () => {
        const result = parseRepoUrl('https://github.com/owner/repo.git')
        expect(result.url).toBe('https://github.com/owner/repo')
    })

    it('normalizes to lowercase', () => {
        const result = parseRepoUrl('https://GitHub.com/Owner/Repo')
        expect(result.url).toBe('https://github.com/owner/repo')
        expect(result.owner).toBe('owner')
        expect(result.repo).toBe('repo')
    })

    it('handles owner/repo shorthand', () => {
        const result = parseRepoUrl('sveltejs/svelte')
        expect(result.url).toBe('https://github.com/sveltejs/svelte')
        expect(result.host).toBe('github.com')
    })

    it('handles GitLab URLs', () => {
        const result = parseRepoUrl('https://gitlab.com/owner/project')
        expect(result.host).toBe('gitlab.com')
        expect(result.url).toBe('https://gitlab.com/owner/project')
    })

    it('handles Bitbucket URLs', () => {
        const result = parseRepoUrl('https://bitbucket.org/owner/repo')
        expect(result.host).toBe('bitbucket.org')
    })

    it('strips trailing slashes', () => {
        const result = parseRepoUrl('https://github.com/owner/repo/')
        expect(result.url).toBe('https://github.com/owner/repo')
    })

    it('trims whitespace', () => {
        const result = parseRepoUrl('  https://github.com/owner/repo  ')
        expect(result.url).toBe('https://github.com/owner/repo')
    })

    it('throws on empty input', () => {
        expect(() => parseRepoUrl('')).toThrow('empty')
    })

    it('throws on unsupported host', () => {
        expect(() => parseRepoUrl('https://example.com/owner/repo')).toThrow('Unsupported host')
    })

    it('throws on invalid URL', () => {
        expect(() => parseRepoUrl('not-a-url-at-all')).toThrow()
    })

    it('throws when path has no repo', () => {
        expect(() => parseRepoUrl('https://github.com/onlyone')).toThrow('owner and repository name')
    })
})

describe('parseRepoFromPathname', () => {
    it('parses /github.com/owner/repo', () => {
        const result = parseRepoFromPathname('/github.com/sveltejs/svelte')
        expect(result).toEqual({
            url: 'https://github.com/sveltejs/svelte',
            host: 'github.com',
            owner: 'sveltejs',
            repo: 'svelte',
        })
    })

    it('parses GitLab pathname', () => {
        const result = parseRepoFromPathname('/gitlab.com/owner/project')
        expect(result).toEqual(expect.objectContaining({ host: 'gitlab.com' }))
    })

    it('returns null for root path', () => {
        expect(parseRepoFromPathname('/')).toBeNull()
    })

    it('returns null for empty string', () => {
        expect(parseRepoFromPathname('')).toBeNull()
    })

    it('returns null for invalid path', () => {
        expect(parseRepoFromPathname('/not-a-host/owner/repo')).toBeNull()
    })
})

describe('repoToDir', () => {
    it('produces filesystem-safe directory name', () => {
        const parsed = parseRepoUrl('https://github.com/sveltejs/svelte')
        expect(repoToDir(parsed)).toBe('/github.com/sveltejs/svelte')
    })
})
