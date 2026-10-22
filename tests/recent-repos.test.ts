import { describe, it, expect } from 'vitest'
import { rankRecentRepos, recordVisit, type VisitLog } from '#lib/recent-repos.js'

const hour = 60 * 60 * 1000
const day = 24 * hour
const t0 = Date.parse('2026-10-01T12:00:00Z')

const visitMany = (log: VisitLog, repoUrl: string, times: number, start: number, gapMs: number): VisitLog => {
    let next = log
    for (let i = 0; i < times; i++) next = recordVisit(next, repoUrl, start + i * gapMs)
    return next
}

describe('recordVisit', () => {
    it('counts repeat visits within an hour once', () => {
        const log = visitMany({}, 'a', 1000, t0, 1000)
        expect(log.a.score).toBe(1)
    })

    it('adds up visits spread over time', () => {
        const log = visitMany({}, 'a', 3, t0, 2 * hour)
        expect(log.a.score).toBeGreaterThan(2.9)
        expect(log.a.score).toBeLessThan(3)
    })
})

describe('rankRecentRepos', () => {
    it('ranks the most visited repo first', () => {
        let log = visitMany({}, 'cmdr', 10, t0, 2 * hour)
        log = visitMany(log, 'other', 2, t0, 2 * hour)
        expect(rankRecentRepos(['other', 'cmdr'], {}, log, t0 + day)).toEqual(['cmdr', 'other'])
    })

    it('lets a fresh favorite overtake one unseen for two weeks', () => {
        // A month of heavy daily use
        let log = visitMany({}, 'cmdr', 30 * 6, t0, 4 * hour)
        const lastCmdr = t0 + 30 * day
        // Two weeks later, a new project gets opened a couple times
        log = visitMany(log, 'newproject', 2, lastCmdr + 14 * day, 2 * hour)
        expect(rankRecentRepos(['cmdr', 'newproject'], {}, log, lastCmdr + 14 * day + 4 * hour)).toEqual([
            'newproject',
            'cmdr',
        ])
    })

    it('ranks cached repos with no visit record by their last access', () => {
        const ranked = rankRecentRepos(
            ['old', 'newer'],
            { old: new Date(t0 - 10 * day).toISOString(), newer: new Date(t0 - day).toISOString() },
            {},
            t0,
        )
        expect(ranked).toEqual(['newer', 'old'])
    })

    it('only lists repos that are still cached', () => {
        const log = visitMany({}, 'deleted', 5, t0, 2 * hour)
        expect(rankRecentRepos(['kept'], {}, log, t0 + day)).toEqual(['kept'])
    })
})
