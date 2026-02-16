import { describe, it, expect } from 'vitest'
import { generateConsecutiveDates, fillDateGaps, type DailyCommit } from '../src/lib/git/history'

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
