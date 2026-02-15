/** Line counts for a single language in a single day */
export interface LanguageCount {
	/** Total lines (prod + test) */
	total: number;
	/** Lines classified as production code (undefined if no prod/test heuristic exists) */
	prod?: number;
	/** Lines classified as test code (undefined if no prod/test heuristic exists) */
	test?: number;
}

/** One row per calendar date */
export interface DayStats {
	date: string; // 'YYYY-MM-DD'
	total: number; // Sum of all languages
	languages: Record<string, LanguageCount>; // Keyed by language id
	comments: string[]; // Commit messages for this day
}

/** Full analysis result, stored in cache */
export interface AnalysisResult {
	repoUrl: string;
	defaultBranch: string;
	/** OID of HEAD at analysis time — used for freshness checking */
	headCommit: string;
	analyzedAt: string; // ISO 8601
	/** Language ids that appear in this result, sorted by final-day line count descending */
	detectedLanguages: string[];
	days: DayStats[];
}

/** Payload stored in the shared server cache (R2) */
export interface SharedCacheEntry {
	version: 1;
	repoUrl: string;
	headCommit: string;
	result: AnalysisResult;
	updatedAt: string; // ISO 8601
}

/** Categorized error types for user-facing messages */
export type ErrorKind =
	| 'not-found'
	| 'auth-required'
	| 'cors-proxy-down'
	| 'network-lost'
	| 'repo-too-large'
	| 'indexeddb-full'
	| 'cancelled'
	| 'unknown';

/** Progress updates from the worker */
export type ProgressEvent =
	| { type: 'clone'; phase: string; loaded: number; total: number }
	| { type: 'process'; current: number; total: number; date: string }
	| { type: 'day-result'; day: DayStats }
	| { type: 'done'; result: AnalysisResult }
	| { type: 'error'; message: string; kind: ErrorKind }
	| { type: 'size-warning'; estimatedBytes: number };

/** Definition for a recognized language in the registry */
export interface LanguageDefinition {
	id: string;
	name: string;
	extensions: string[];
	testFilePatterns?: string[];
	testDirPatterns?: string[];
	countInlineTestLines?: (content: string) => number;
	isMeta?: boolean;
}
