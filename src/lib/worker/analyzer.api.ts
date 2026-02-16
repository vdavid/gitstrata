import * as Comlink from 'comlink'
import type { AnalyzerApi } from './analyzer.worker'
import type { AnalysisResult, ProgressEvent } from '../types'

export interface AnalyzerHandle {
    analyze: (
        repoInput: string,
        corsProxy: string,
        onProgress: (event: ProgressEvent) => void,
    ) => Promise<AnalysisResult>
    analyzeIncremental: (
        repoInput: string,
        corsProxy: string,
        cachedResult: AnalysisResult,
        onProgress: (event: ProgressEvent) => void,
    ) => Promise<AnalysisResult>
    cancel: () => Promise<void>
    terminate: () => void
}

/** Create a new analyzer worker instance */
export const createAnalyzer = (): AnalyzerHandle => {
    const worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), {
        type: 'module',
    })

    const api = Comlink.wrap<AnalyzerApi>(worker)

    return {
        analyze: async (repoInput, corsProxy, onProgress) => {
            return api.analyze(repoInput, corsProxy, Comlink.proxy(onProgress))
        },
        analyzeIncremental: async (repoInput, corsProxy, cachedResult, onProgress) => {
            return api.analyzeIncremental(repoInput, corsProxy, cachedResult, Comlink.proxy(onProgress))
        },
        cancel: () => api.cancel(),
        terminate: () => {
            worker.terminate()
        },
    }
}
