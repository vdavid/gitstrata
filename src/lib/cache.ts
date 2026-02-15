import { openDB, type IDBPDatabase } from 'idb';
import type { AnalysisResult } from './types';

const dbName = 'git-strata';
const dbVersion = 1;
const storeName = 'results';

/** 500 MB cache limit for LRU eviction */
const maxCacheBytes = 500 * 1024 * 1024;

interface CachedResult {
	repoUrl: string;
	result: AnalysisResult;
	lastAccessed: string; // ISO 8601
	sizeBytes: number;
}

export interface CachedRepoInfo {
	repoUrl: string;
	analyzedAt: string;
	lastAccessed: string;
	sizeBytes: number;
}

const getDb = async (): Promise<IDBPDatabase> => {
	return openDB(dbName, dbVersion, {
		upgrade(db) {
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName, { keyPath: 'repoUrl' });
			}
		}
	});
};

const estimateSize = (value: unknown): number => {
	try {
		return new Blob([JSON.stringify(value)]).size;
	} catch {
		return 0;
	}
};

export const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export const saveResult = async (result: AnalysisResult): Promise<void> => {
	const db = await getDb();
	const sizeBytes = estimateSize(result);
	const entry: CachedResult = {
		repoUrl: result.repoUrl,
		result,
		lastAccessed: new Date().toISOString(),
		sizeBytes
	};

	// Evict LRU entries if adding this would exceed the limit
	await evictIfNeeded(db, sizeBytes, result.repoUrl);

	await db.put(storeName, entry);
};

export const getResult = async (repoUrl: string): Promise<AnalysisResult | undefined> => {
	const db = await getDb();
	const entry = (await db.get(storeName, repoUrl)) as CachedResult | undefined;
	if (!entry) return undefined;

	// Update last-accessed timestamp
	entry.lastAccessed = new Date().toISOString();
	await db.put(storeName, entry);

	return entry.result;
};

export const listCachedRepos = async (): Promise<CachedRepoInfo[]> => {
	const db = await getDb();
	const entries = (await db.getAll(storeName)) as CachedResult[];
	return entries.map((e) => ({
		repoUrl: e.repoUrl,
		analyzedAt: e.result.analyzedAt,
		lastAccessed: e.lastAccessed,
		sizeBytes: e.sizeBytes ?? 0
	}));
};

export const deleteRepo = async (repoUrl: string): Promise<void> => {
	const db = await getDb();
	await db.delete(storeName, repoUrl);
};

export const clearAll = async (): Promise<void> => {
	const db = await getDb();
	await db.clear(storeName);
};

export const getTotalSize = async (): Promise<number> => {
	const db = await getDb();
	const entries = (await db.getAll(storeName)) as CachedResult[];
	return entries.reduce((sum, e) => sum + (e.sizeBytes ?? 0), 0);
};

const evictIfNeeded = async (
	db: IDBPDatabase,
	neededBytes: number,
	excludeUrl: string
): Promise<void> => {
	const entries = (await db.getAll(storeName)) as CachedResult[];
	let totalBytes = entries.reduce((sum, e) => sum + (e.sizeBytes ?? 0), 0);

	if (totalBytes + neededBytes <= maxCacheBytes) return;

	// Sort by lastAccessed ascending (oldest first) for LRU eviction
	const sorted = entries
		.filter((e) => e.repoUrl !== excludeUrl)
		.sort((a, b) => a.lastAccessed.localeCompare(b.lastAccessed));

	for (const entry of sorted) {
		if (totalBytes + neededBytes <= maxCacheBytes) break;
		totalBytes -= entry.sizeBytes ?? 0;
		await db.delete(storeName, entry.repoUrl);
	}
};
