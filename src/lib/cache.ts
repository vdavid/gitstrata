import { openDB, type IDBPDatabase } from 'idb';
import type { AnalysisResult } from './types';

const dbName = 'git-strata';
const dbVersion = 1;
const storeName = 'results';

interface CachedResult {
	repoUrl: string;
	result: AnalysisResult;
	lastAccessed: string; // ISO 8601
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

/** Store an analysis result in the cache */
export const cacheResult = async (result: AnalysisResult): Promise<void> => {
	const db = await getDb();
	const entry: CachedResult = {
		repoUrl: result.repoUrl,
		result,
		lastAccessed: new Date().toISOString()
	};
	await db.put(storeName, entry);
};

/** Retrieve a cached analysis result by normalized repo URL */
export const getCachedResult = async (repoUrl: string): Promise<AnalysisResult | undefined> => {
	const db = await getDb();
	const entry = (await db.get(storeName, repoUrl)) as CachedResult | undefined;
	if (!entry) return undefined;

	// Update last-accessed timestamp
	entry.lastAccessed = new Date().toISOString();
	await db.put(storeName, entry);

	return entry.result;
};

/** List all cached repos with their last-access timestamps */
export const listCachedRepos = async (): Promise<
	Array<{ repoUrl: string; analyzedAt: string; lastAccessed: string }>
> => {
	const db = await getDb();
	const entries = (await db.getAll(storeName)) as CachedResult[];
	return entries.map((e) => ({
		repoUrl: e.repoUrl,
		analyzedAt: e.result.analyzedAt,
		lastAccessed: e.lastAccessed
	}));
};

/** Delete a cached result */
export const deleteCachedResult = async (repoUrl: string): Promise<void> => {
	const db = await getDb();
	await db.delete(storeName, repoUrl);
};

/** Clear all cached results */
export const clearCache = async (): Promise<void> => {
	const db = await getDb();
	await db.clear(storeName);
};
