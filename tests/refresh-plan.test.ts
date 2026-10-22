import { describe, it, expect } from 'vitest'
import { pickRefreshPlan } from '../src/lib/refresh-plan'
import type { AnalysisResult } from '../src/lib/types'

const oldHead = 'a'.repeat(40)
const newHead = 'b'.repeat(40)
const engineVersion = 3

const makeResult = (overrides: Partial<AnalysisResult>): AnalysisResult => ({
    repoUrl: 'https://github.com/owner/repo',
    defaultBranch: 'main',
    headCommit: oldHead,
    analyzedAt: '2026-01-01T00:00:00Z',
    detectedLanguages: [],
    days: [],
    engineVersion,
    ...overrides,
})

describe('pickRefreshPlan', () => {
    it('adopts a shared result that is at the remote HEAD with the current engine', () => {
        const local = makeResult({})
        const server = makeResult({ headCommit: newHead, analyzedAt: '2026-02-01T00:00:00Z' })
        expect(pickRefreshPlan({ local, server, remoteHead: newHead, engineVersion })).toBe('adopt-server')
    })

    it('does not adopt a shared result from another engine version', () => {
        const local = makeResult({})
        const server = makeResult({ headCommit: newHead, analyzedAt: '2026-02-01T00:00:00Z', engineVersion: 2 })
        expect(pickRefreshPlan({ local, server, remoteHead: newHead, engineVersion })).toBe('roll-on-from-local')
    })

    it('does not adopt a shared result without an engine version', () => {
        const local = makeResult({})
        const server = makeResult({ headCommit: newHead, engineVersion: undefined })
        expect(pickRefreshPlan({ local, server, remoteHead: newHead, engineVersion })).toBe('roll-on-from-local')
    })

    it('is up to date when the local result is at the remote HEAD with the current engine', () => {
        const local = makeResult({ headCommit: newHead })
        const server = makeResult({ headCommit: newHead, analyzedAt: '2026-02-01T00:00:00Z' })
        expect(pickRefreshPlan({ local, server, remoteHead: newHead, engineVersion })).toBe('up-to-date')
    })

    it('adopts a current shared result when the local one is at HEAD but from an old engine', () => {
        const local = makeResult({ headCommit: newHead, engineVersion: 2 })
        const server = makeResult({ headCommit: newHead })
        expect(pickRefreshPlan({ local, server, remoteHead: newHead, engineVersion })).toBe('adopt-server')
    })

    it('rolls on from the shared result when it is newer but behind the remote', () => {
        const local = makeResult({ analyzedAt: '2026-01-01T00:00:00Z' })
        const server = makeResult({ headCommit: 'c'.repeat(40), analyzedAt: '2026-02-01T00:00:00Z' })
        expect(pickRefreshPlan({ local, server, remoteHead: newHead, engineVersion })).toBe('roll-on-from-server')
    })

    it('rolls on from the local result when it is newer than the shared one', () => {
        const local = makeResult({ headCommit: 'c'.repeat(40), analyzedAt: '2026-03-01T00:00:00Z' })
        const server = makeResult({ analyzedAt: '2026-02-01T00:00:00Z' })
        expect(pickRefreshPlan({ local, server, remoteHead: newHead, engineVersion })).toBe('roll-on-from-local')
    })

    it('prefers a base from the current engine over a newer one from an old engine', () => {
        const local = makeResult({ analyzedAt: '2026-01-01T00:00:00Z' })
        const server = makeResult({ analyzedAt: '2026-02-01T00:00:00Z', engineVersion: 2 })
        expect(pickRefreshPlan({ local, server, remoteHead: newHead, engineVersion })).toBe('roll-on-from-local')
    })

    it('rolls on from the local result without a shared one', () => {
        const local = makeResult({})
        expect(pickRefreshPlan({ local, server: undefined, remoteHead: newHead, engineVersion })).toBe(
            'roll-on-from-local',
        )
    })

    it('rolls on from the newer base when the remote HEAD is unknown', () => {
        const local = makeResult({ analyzedAt: '2026-01-01T00:00:00Z' })
        const server = makeResult({ headCommit: newHead, analyzedAt: '2026-02-01T00:00:00Z' })
        expect(pickRefreshPlan({ local, server, remoteHead: undefined, engineVersion })).toBe('roll-on-from-server')
    })
})
