import { describe, it, expect, vi } from 'vitest'
import { parseMailmap, createMailmapLookup, readMailmapFromRepo } from '$lib/git/mailmap'

describe('parseMailmap', () => {
    it('parses form 1: Proper Name <commit@email>', () => {
        const entries = parseMailmap('Jane Doe <jane@old.com>')
        expect(entries).toEqual([{ properName: 'Jane Doe', commitEmail: 'jane@old.com' }])
    })

    it('parses form 2: <proper@email> <commit@email>', () => {
        const entries = parseMailmap('<jane@new.com> <jane@old.com>')
        expect(entries).toEqual([{ properEmail: 'jane@new.com', commitEmail: 'jane@old.com' }])
    })

    it('parses form 3: Proper Name <proper@email> <commit@email>', () => {
        const entries = parseMailmap('Jane Doe <jane@new.com> <jane@old.com>')
        expect(entries).toEqual([{ properName: 'Jane Doe', properEmail: 'jane@new.com', commitEmail: 'jane@old.com' }])
    })

    it('parses form 4: Proper Name <proper@email> Commit Name <commit@email>', () => {
        const entries = parseMailmap('Jane Doe <jane@new.com> Old Jane <jane@old.com>')
        expect(entries).toEqual([
            {
                properName: 'Jane Doe',
                properEmail: 'jane@new.com',
                commitName: 'Old Jane',
                commitEmail: 'jane@old.com',
            },
        ])
    })

    it('skips comments and blank lines', () => {
        const input = `
# This is a comment
Jane Doe <jane@old.com>

# Another comment
John Smith <john@new.com> <john@old.com>
        `
        const entries = parseMailmap(input)
        expect(entries).toHaveLength(2)
        expect(entries[0].properName).toBe('Jane Doe')
        expect(entries[1].properName).toBe('John Smith')
    })

    it('handles multiple entries', () => {
        const input = [
            'Jane Doe <jane@old.com>',
            '<bob@new.com> <bob@old.com>',
            'Charlie <charlie@new.com> <charlie@old.com>',
            'Delta New <delta@new.com> Delta Old <delta@old.com>',
        ].join('\n')

        const entries = parseMailmap(input)
        expect(entries).toHaveLength(4)
    })
})

describe('createMailmapLookup', () => {
    it('applies form 1: replaces name only', () => {
        const entries = parseMailmap('Jane Doe <jane@old.com>')
        const lookup = createMailmapLookup(entries)
        expect(lookup('jdoe', 'jane@old.com')).toBe('Jane Doe <jane@old.com>')
    })

    it('applies form 2: replaces email only', () => {
        const entries = parseMailmap('<jane@new.com> <jane@old.com>')
        const lookup = createMailmapLookup(entries)
        expect(lookup('Jane', 'jane@old.com')).toBe('Jane <jane@new.com>')
    })

    it('applies form 3: replaces both by email match', () => {
        const entries = parseMailmap('Jane Doe <jane@new.com> <jane@old.com>')
        const lookup = createMailmapLookup(entries)
        expect(lookup('whatever', 'jane@old.com')).toBe('Jane Doe <jane@new.com>')
    })

    it('applies form 4: replaces both by name+email match', () => {
        const entries = parseMailmap('Jane Doe <jane@new.com> Old Jane <jane@old.com>')
        const lookup = createMailmapLookup(entries)
        expect(lookup('Old Jane', 'jane@old.com')).toBe('Jane Doe <jane@new.com>')
    })

    it('uses case-insensitive email matching', () => {
        const entries = parseMailmap('Jane Doe <jane@new.com> <JANE@OLD.COM>')
        const lookup = createMailmapLookup(entries)
        expect(lookup('x', 'jane@old.com')).toBe('Jane Doe <jane@new.com>')
        expect(lookup('x', 'Jane@Old.Com')).toBe('Jane Doe <jane@new.com>')
    })

    it('form 4 wins over form 1 for same email', () => {
        const input = ['Generic Name <jane@old.com>', 'Specific Name <jane@new.com> Old Jane <jane@old.com>'].join('\n')
        const entries = parseMailmap(input)
        const lookup = createMailmapLookup(entries)

        // Form 4 matches because name matches
        expect(lookup('Old Jane', 'jane@old.com')).toBe('Specific Name <jane@new.com>')
        // Form 1 matches for different name (form 4 doesn't match name)
        expect(lookup('someone-else', 'jane@old.com')).toBe('Generic Name <jane@old.com>')
    })

    it('form 3 wins over form 1 for same email', () => {
        const input = ['Name Only <jane@old.com>', 'Full Replace <jane@new.com> <jane@old.com>'].join('\n')
        const entries = parseMailmap(input)
        const lookup = createMailmapLookup(entries)

        // Form 3 has properEmail, so it wins over form 1
        expect(lookup('whoever', 'jane@old.com')).toBe('Full Replace <jane@new.com>')
    })

    it('returns original identity when no match', () => {
        const entries = parseMailmap('Jane Doe <jane@new.com> <jane@old.com>')
        const lookup = createMailmapLookup(entries)
        expect(lookup('Bob', 'bob@example.com')).toBe('Bob <bob@example.com>')
    })
})

describe('readMailmapFromRepo', () => {
    it('returns [] when no .mailmap exists', async () => {
        const mockFs = {} as never
        const mockGit = await import('isomorphic-git')

        // Mock the git calls
        vi.spyOn(mockGit.default, 'readCommit').mockResolvedValue({
            oid: 'abc123',
            commit: {
                tree: 'tree-oid',
                parent: [],
                author: { name: '', email: '', timestamp: 0, timezoneOffset: 0 },
                committer: { name: '', email: '', timestamp: 0, timezoneOffset: 0 },
                message: '',
            },
            payload: '',
        })

        vi.spyOn(mockGit.default, 'readTree').mockResolvedValue({
            oid: 'tree-oid',
            tree: [
                { mode: '100644', path: 'README.md', oid: 'readme-oid', type: 'blob' },
                { mode: '100644', path: 'src', oid: 'src-oid', type: 'tree' },
            ],
        })

        const result = await readMailmapFromRepo(mockFs, '/repo', 'HEAD')
        expect(result).toEqual([])

        vi.restoreAllMocks()
    })

    it('returns [] when git calls fail', async () => {
        const mockFs = {} as never
        const mockGit = await import('isomorphic-git')

        vi.spyOn(mockGit.default, 'readCommit').mockRejectedValue(new Error('not a git repo'))

        const result = await readMailmapFromRepo(mockFs, '/repo', 'HEAD')
        expect(result).toEqual([])

        vi.restoreAllMocks()
    })
})
