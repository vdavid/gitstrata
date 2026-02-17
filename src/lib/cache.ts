import { openDB, type IDBPDatabase } from 'idb'
import type { AnalysisResult } from './types'
import { repoUrlToFsName } from './url'

const dbName = 'git-strata'
const dbVersion = 2
const storeName = 'results'
const metaStoreName = 'results-meta'

/** 500 MB cache limit for LRU eviction */
const maxCacheBytes = 500 * 1024 * 1024

interface CachedResult {
    repoUrl: string
    result: AnalysisResult
    lastAccessed: string // ISO 8601
    sizeBytes: number
}

export interface CachedRepoInfo {
    repoUrl: string
    analyzedAt: string
    lastAccessed: string
    sizeBytes: number
}

const getDb = async (): Promise<IDBPDatabase> => {
    return openDB(dbName, dbVersion, {
        upgrade(db, oldVersion, _newVersion, transaction) {
            if (oldVersion < 1) {
                db.createObjectStore(storeName, { keyPath: 'repoUrl' })
            }
            if (oldVersion < 2) {
                db.createObjectStore(metaStoreName, { keyPath: 'repoUrl' })
                // Backfill meta from existing results (~3 users, <10 entries)
                if (db.objectStoreNames.contains(storeName)) {
                    const store = transaction.objectStore(storeName)
                    const metaStore = transaction.objectStore(metaStoreName)
                    void store.getAll().then((entries: CachedResult[]) => {
                        for (const entry of entries) {
                            void metaStore.put({
                                repoUrl: entry.repoUrl,
                                analyzedAt: entry.result?.analyzedAt ?? '',
                                lastAccessed: entry.lastAccessed ?? new Date().toISOString(),
                                sizeBytes: entry.sizeBytes ?? 0,
                            })
                        }
                    })
                }
            }
        },
    })
}

const notifyCacheChange = () => {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('cache-changed'))
    }
}

/** Delete the LightningFS IndexedDB database for a repo. Fire-and-forget. */
const deleteLfsDatabase = (repoUrl: string): void => {
    try {
        indexedDB.deleteDatabase(repoUrlToFsName(repoUrl))
    } catch {
        // Invalid URL or indexedDB unavailable — nothing to clean up
    }
}

const estimateSize = (value: unknown): number => {
    try {
        return new Blob([JSON.stringify(value)]).size
    } catch {
        return 0
    }
}

export const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export const saveResult = async (result: AnalysisResult): Promise<void> => {
    const db = await getDb()
    const sizeBytes = estimateSize(result)
    const now = new Date().toISOString()
    const entry: CachedResult = {
        repoUrl: result.repoUrl,
        result,
        lastAccessed: now,
        sizeBytes,
    }
    const meta: CachedRepoInfo = {
        repoUrl: result.repoUrl,
        analyzedAt: result.analyzedAt,
        lastAccessed: now,
        sizeBytes,
    }

    // Evict LRU entries if adding this would exceed the limit
    await evictIfNeeded(db, sizeBytes, result.repoUrl)

    try {
        const tx = db.transaction([storeName, metaStoreName], 'readwrite')
        tx.objectStore(storeName).put(entry)
        tx.objectStore(metaStoreName).put(meta)
        await tx.done
    } catch (error) {
        // QuotaExceededError or other storage failures — skip caching.
        // The analysis result is still shown to the user; caching is best-effort.
        console.warn('[cache] Failed to save result, skipping:', error)
        return
    }
    notifyCacheChange()
}

export const getResult = async (repoUrl: string): Promise<AnalysisResult | undefined> => {
    const db = await getDb()
    const entry = (await db.get(storeName, repoUrl)) as CachedResult | undefined
    if (!entry) return undefined

    // Update last-accessed timestamp in meta only (best-effort, lightweight)
    const now = new Date().toISOString()
    void db
        .put(metaStoreName, {
            repoUrl: entry.repoUrl,
            analyzedAt: entry.result.analyzedAt,
            lastAccessed: now,
            sizeBytes: entry.sizeBytes,
        } satisfies CachedRepoInfo)
        .catch((error: unknown) => {
            console.warn('[cache] Failed to update lastAccessed:', error)
        })

    return entry.result
}

export const listCachedRepos = async (): Promise<CachedRepoInfo[]> => {
    const db = await getDb()
    const metas = (await db.getAll(metaStoreName)) as CachedRepoInfo[]
    return metas.map((m) => ({
        repoUrl: m.repoUrl,
        analyzedAt: m.analyzedAt,
        lastAccessed: m.lastAccessed,
        sizeBytes: m.sizeBytes ?? 0,
    }))
}

export const deleteRepo = async (repoUrl: string): Promise<void> => {
    const db = await getDb()
    const tx = db.transaction([storeName, metaStoreName], 'readwrite')
    tx.objectStore(storeName).delete(repoUrl)
    tx.objectStore(metaStoreName).delete(repoUrl)
    await tx.done
    deleteLfsDatabase(repoUrl)
    notifyCacheChange()
}

export const clearAll = async (): Promise<void> => {
    const db = await getDb()
    // Read all repo URLs before clearing so we can delete their LightningFS databases
    const metas = (await db.getAll(metaStoreName)) as CachedRepoInfo[]
    const tx = db.transaction([storeName, metaStoreName], 'readwrite')
    tx.objectStore(storeName).clear()
    tx.objectStore(metaStoreName).clear()
    await tx.done
    for (const meta of metas) deleteLfsDatabase(meta.repoUrl)
    notifyCacheChange()
}

export const getTotalSize = async (): Promise<number> => {
    const db = await getDb()
    const metas = (await db.getAll(metaStoreName)) as CachedRepoInfo[]
    return metas.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0)
}

const evictIfNeeded = async (db: IDBPDatabase, neededBytes: number, excludeUrl: string): Promise<void> => {
    const metas = (await db.getAll(metaStoreName)) as CachedRepoInfo[]
    let totalBytes = metas.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0)

    if (totalBytes + neededBytes <= maxCacheBytes) return

    // Sort by lastAccessed ascending (oldest first) for LRU eviction
    const sorted = metas
        .filter((m) => m.repoUrl !== excludeUrl)
        .sort((a, b) => a.lastAccessed.localeCompare(b.lastAccessed))

    const toDelete: string[] = []
    for (const meta of sorted) {
        if (totalBytes + neededBytes <= maxCacheBytes) break
        totalBytes -= meta.sizeBytes ?? 0
        toDelete.push(meta.repoUrl)
    }

    if (toDelete.length > 0) {
        const tx = db.transaction([storeName, metaStoreName], 'readwrite')
        for (const url of toDelete) {
            tx.objectStore(storeName).delete(url)
            tx.objectStore(metaStoreName).delete(url)
        }
        await tx.done
        for (const url of toDelete) deleteLfsDatabase(url)
    }
}
