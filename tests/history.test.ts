import { describe, it, expect } from 'vitest'
import { generateConsecutiveDates, fillDateGaps, CompactOidSet, type DailyCommit } from '$lib/git/history'

describe('generateConsecutiveDates', () => {
    it('generates dates between start and end inclusive', () => {
        const dates = generateConsecutiveDates('2024-01-01', '2024-01-05')
        expect(dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'])
    })

    it('returns single date when start equals end', () => {
        const dates = generateConsecutiveDates('2024-06-15', '2024-06-15')
        expect(dates).toEqual(['2024-06-15'])
    })

    it('handles month boundaries', () => {
        const dates = generateConsecutiveDates('2024-01-30', '2024-02-02')
        expect(dates).toEqual(['2024-01-30', '2024-01-31', '2024-02-01', '2024-02-02'])
    })

    it('handles year boundaries', () => {
        const dates = generateConsecutiveDates('2023-12-30', '2024-01-02')
        expect(dates).toEqual(['2023-12-30', '2023-12-31', '2024-01-01', '2024-01-02'])
    })

    it('handles leap year', () => {
        const dates = generateConsecutiveDates('2024-02-28', '2024-03-01')
        expect(dates).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
    })
})

describe('fillDateGaps', () => {
    it('returns empty array for empty input', () => {
        expect(fillDateGaps([])).toEqual([])
    })

    it('fills gaps between commits', () => {
        const commits: DailyCommit[] = [
            { date: '2024-01-01', hash: 'abc', messages: ['first'], authors: ['Alice <alice@example.com>'] },
            { date: '2024-01-03', hash: 'def', messages: ['third'], authors: ['Bob <bob@example.com>'] },
        ]
        const result = fillDateGaps(commits)
        expect(result).toHaveLength(3)
        expect(result[0].date).toBe('2024-01-01')
        expect(result[0].commit).toBeDefined()
        expect(result[1].date).toBe('2024-01-02')
        expect(result[1].commit).toBeUndefined()
        expect(result[2].date).toBe('2024-01-03')
        expect(result[2].commit).toBeDefined()
    })

    it('handles consecutive commits with no gaps', () => {
        const commits: DailyCommit[] = [
            { date: '2024-01-01', hash: 'abc', messages: ['a'], authors: [] },
            { date: '2024-01-02', hash: 'def', messages: ['b'], authors: [] },
        ]
        const result = fillDateGaps(commits)
        expect(result).toHaveLength(2)
        expect(result.every((r) => r.commit !== undefined)).toBe(true)
    })

    it('handles single commit', () => {
        const commits: DailyCommit[] = [{ date: '2024-01-15', hash: 'abc', messages: ['only'], authors: [] }]
        const result = fillDateGaps(commits)
        expect(result).toHaveLength(1)
        expect(result[0].commit?.hash).toBe('abc')
    })
})

describe('DailyCommit authors', () => {
    it('preserves authors from commit data', () => {
        const commits: DailyCommit[] = [
            {
                date: '2024-01-01',
                hash: 'abc',
                messages: ['init'],
                authors: ['Alice <alice@example.com>'],
            },
            {
                date: '2024-01-02',
                hash: 'def',
                messages: ['update'],
                authors: ['Bob <bob@example.com>', 'Carol <carol@example.com>'],
            },
        ]
        expect(commits[0].authors).toEqual(['Alice <alice@example.com>'])
        expect(commits[1].authors).toHaveLength(2)
        expect(commits[1].authors).toContain('Bob <bob@example.com>')
        expect(commits[1].authors).toContain('Carol <carol@example.com>')
    })

    it('deduplicates authors within a single day', () => {
        const authorSet = new Set<string>()
        authorSet.add('Alice <alice@example.com>')
        authorSet.add('Alice <alice@example.com>')
        authorSet.add('Bob <bob@example.com>')
        const authors = [...authorSet]
        expect(authors).toHaveLength(2)
        expect(authors).toContain('Alice <alice@example.com>')
        expect(authors).toContain('Bob <bob@example.com>')
    })

    it('gap days get empty authors array via fillDateGaps', () => {
        const commits: DailyCommit[] = [
            { date: '2024-01-01', hash: 'abc', messages: ['first'], authors: ['Alice <alice@example.com>'] },
            { date: '2024-01-03', hash: 'def', messages: ['third'], authors: ['Bob <bob@example.com>'] },
        ]
        const result = fillDateGaps(commits)
        expect(result).toHaveLength(3)
        // Day with commit has authors
        expect(result[0].commit?.authors).toEqual(['Alice <alice@example.com>'])
        // Gap day has no commit
        expect(result[1].commit).toBeUndefined()
        // Day with commit has authors
        expect(result[2].commit?.authors).toEqual(['Bob <bob@example.com>'])
    })
})

describe('CompactOidSet', () => {
    const makeOid = (n: number): string => n.toString(16).padStart(40, '0')

    it('adds and checks membership', () => {
        const set = new CompactOidSet()
        const oid = makeOid(0xdeadbeef)
        expect(set.has(oid)).toBe(false)
        expect(set.add(oid)).toBe(true)
        expect(set.has(oid)).toBe(true)
        expect(set.size).toBe(1)
    })

    it('returns false when adding a duplicate', () => {
        const set = new CompactOidSet()
        const oid = makeOid(42)
        set.add(oid)
        expect(set.add(oid)).toBe(false)
        expect(set.size).toBe(1)
    })

    it('handles many entries with automatic growth', () => {
        const set = new CompactOidSet(16) // small initial capacity to force growth
        const count = 5000
        for (let i = 0; i < count; i++) {
            expect(set.add(makeOid(i))).toBe(true)
        }
        expect(set.size).toBe(count)
        for (let i = 0; i < count; i++) {
            expect(set.has(makeOid(i))).toBe(true)
        }
        // Verify no false positives for OIDs not in the set
        for (let i = count; i < count + 1000; i++) {
            expect(set.has(makeOid(i))).toBe(false)
        }
    })

    it('handles realistic 40-char hex OIDs', () => {
        const set = new CompactOidSet()
        const oids = [
            'a'.repeat(40),
            'b'.repeat(40),
            '0123456789abcdef0123456789abcdef01234567',
            'deadbeefcafebabedeadbeefcafebabedeadbeef',
        ]
        for (const oid of oids) set.add(oid)
        expect(set.size).toBe(4)
        for (const oid of oids) expect(set.has(oid)).toBe(true)
    })

    it('handles uppercase hex', () => {
        const set = new CompactOidSet()
        set.add('AABBCCDD00112233445566778899AABBCCDDEEFF')
        expect(set.has('aabbccdd00112233445566778899aabbccddeeff')).toBe(true)
    })
})
