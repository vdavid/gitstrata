import type { AnalysisResult } from './types'

export type RefreshPlan = 'up-to-date' | 'adopt-server' | 'roll-on-from-local' | 'roll-on-from-server'

/**
 * Decide how to bring the shown result up to the remote HEAD. A shared result already at that HEAD (same counting
 * engine) beats any local work: another device did the counting. Otherwise roll on from the fresher base, preferring
 * one from the current engine, since an engine mismatch forces a full recompute. `rollOnAnalysis` verifies ancestry
 * itself, so either base is safe.
 */
export const pickRefreshPlan = ({
    local,
    server,
    remoteHead,
    engineVersion,
}: {
    local: AnalysisResult
    server: AnalysisResult | undefined
    remoteHead: string | undefined
    engineVersion: number
}): RefreshPlan => {
    const isCurrent = (r: AnalysisResult) => r.headCommit === remoteHead && r.engineVersion === engineVersion
    if (remoteHead !== undefined && isCurrent(local)) return 'up-to-date'
    if (!server) return 'roll-on-from-local'
    if (remoteHead !== undefined && isCurrent(server)) return 'adopt-server'

    const localEngineMatches = local.engineVersion === engineVersion
    const serverEngineMatches = server.engineVersion === engineVersion
    if (localEngineMatches !== serverEngineMatches)
        return localEngineMatches ? 'roll-on-from-local' : 'roll-on-from-server'
    return server.analyzedAt > local.analyzedAt ? 'roll-on-from-server' : 'roll-on-from-local'
}
