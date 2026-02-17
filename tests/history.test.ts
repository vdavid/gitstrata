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
            { date: '2024-01-01', hash: 'abc', messages: ['first'] },
            { date: '2024-01-03', hash: 'def', messages: ['third'] },
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
            { date: '2024-01-01', hash: 'abc', messages: ['a'] },
            { date: '2024-01-02', hash: 'def', messages: ['b'] },
        ]
        const result = fillDateGaps(commits)
        expect(result).toHaveLength(2)
        expect(result.every((r) => r.commit !== undefined)).toBe(true)
    })

    it('handles single commit', () => {
        const commits: DailyCommit[] = [{ date: '2024-01-15', hash: 'abc', messages: ['only'] }]
        const result = fillDateGaps(commits)
        expect(result).toHaveLength(1)
        expect(result[0].commit?.hash).toBe('abc')
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
