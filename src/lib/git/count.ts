import git, { type FsClient } from 'isomorphic-git';
import type { LanguageDefinition } from '../types';
import type { DayStats, LanguageCount } from '../types';
import {
	defaultTestDirPatterns,
	isInTestDir,
	isTestFile,
	resolveHeaderLanguage
} from '../languages';

/** Skip patterns for filenames/extensions that should not be counted (ported from Go) */
const skipPatterns: readonly string[] = [
	// Lock/generated files
	'pnpm-lock.yaml',
	'package-lock.json',
	'yarn.lock',
	'Cargo.lock',
	'go.sum',
	// Binary extensions
	'*.png',
	'*.jpg',
	'*.jpeg',
	'*.gif',
	'*.bmp',
	'*.ico',
	'*.icns',
	'*.woff',
	'*.woff2',
	'*.ttf',
	'*.eot',
	'*.otf',
	'*.lottie',
	'*.zip',
	'*.tar',
	'*.gz',
	'*.bz2',
	'*.xz',
	'*.7z',
	'*.rar',
	'*.pdf',
	'*.exe',
	'*.dll',
	'*.so',
	'*.dylib',
	'*.wasm',
	'*.mp3',
	'*.mp4',
	'*.wav',
	'*.ogg',
	'*.webm',
	'*.webp',
	'*.svg',
	'*.avif'
];

/** Check if a filename should be skipped */
const shouldSkip = (filename: string): boolean => {
	const base = filename.split('/').pop() ?? filename;
	for (const pattern of skipPatterns) {
		if (pattern.startsWith('*')) {
			if (base.endsWith(pattern.slice(1))) return true;
		} else {
			if (base === pattern) return true;
		}
	}
	return false;
};

/** Check for binary content (null bytes in first 8000 bytes) */
const isBinary = (content: Uint8Array): boolean => {
	const limit = Math.min(content.length, 8000);
	for (let i = 0; i < limit; i++) {
		if (content[i] === 0) return true;
	}
	return false;
};

/** Count lines in text content */
export const countLines = (content: string): number => {
	if (content.length === 0) return 0;
	let lines = 0;
	for (let i = 0; i < content.length; i++) {
		if (content[i] === '\n') lines++;
	}
	// Add one if content doesn't end with newline
	if (content[content.length - 1] !== '\n') lines++;
	return lines;
};

/** Get the file extension including the dot, or empty string */
const getExtension = (path: string): string => {
	const base = path.split('/').pop() ?? path;
	const dotIdx = base.lastIndexOf('.');
	if (dotIdx <= 0) return '';
	return base.slice(dotIdx);
};

/** Get the basename of a path */
const getBasename = (path: string): string => {
	return path.split('/').pop() ?? path;
};

/** Cached blob result: line count and classification */
interface BlobCacheEntry {
	lines: number;
	testLines: number;
	languageId: string | undefined;
}

/** Cache key for blob results: (oid, filePath) tuple */
const makeBlobCacheKey = (oid: string, filePath: string): string => {
	return `${oid}\0${filePath}`;
};

/**
 * Tree entry from isomorphic-git readTree or walk.
 * We use git.walk to traverse the tree recursively.
 */
interface FileEntry {
	path: string;
	oid: string;
}

/** Walk a commit tree and return all blob entries */
const listFilesAtCommit = async (options: {
	fs: FsClient;
	dir: string;
	commitOid: string;
}): Promise<FileEntry[]> => {
	const { fs, dir, commitOid } = options;
	const files: FileEntry[] = [];

	await git.walk({
		fs,
		dir,
		trees: [git.TREE({ ref: commitOid })],
		map: async (filepath, entries) => {
			if (!entries || entries.length === 0) return undefined;
			const entry = entries[0];
			if (!entry) return undefined;

			const type = await entry.type();
			if (type === 'blob') {
				const oid = await entry.oid();
				if (oid) {
					files.push({ path: filepath, oid });
				}
			}
			// Return truthy to continue walking into subdirectories
			return true;
		}
	});

	return files;
};

export interface CountOptions {
	fs: FsClient;
	dir: string;
	commitOid: string;
	/** Blob result cache (shared across days for dedup) */
	blobCache: Map<string, BlobCacheEntry>;
	/** Raw blob content cache by OID (shared across days) */
	contentCache: Map<string, string>;
	signal?: AbortSignal;
}

/**
 * Count lines for all files at a given commit, returning DayStats.
 * Uses blob dedup caches to avoid redundant reads and counts.
 */
export const countLinesForCommit = async (
	options: CountOptions,
	date: string,
	messages: string[]
): Promise<DayStats> => {
	const { fs, dir, commitOid, blobCache, contentCache, signal } = options;

	const files = await listFilesAtCommit({ fs, dir, commitOid });

	if (signal?.aborted) {
		throw new Error('Cancelled');
	}

	// Collect all extensions to resolve .h ambiguity
	const allExtensions = new Set<string>();
	for (const file of files) {
		allExtensions.add(getExtension(file.path).toLowerCase());
	}
	const extensionMap = resolveHeaderLanguage(allExtensions);

	const languages: Record<string, LanguageCount> = {};
	let total = 0;

	const addToLanguage = (langId: string, prod: number, test: number) => {
		const existing = languages[langId];
		const lineTotal = prod + test;
		if (existing) {
			existing.total += lineTotal;
			if (existing.prod !== undefined) existing.prod += prod;
			if (existing.test !== undefined) existing.test += test;
		} else {
			languages[langId] = { total: lineTotal, prod, test };
		}
		total += lineTotal;
	};

	const addToLanguageNoSplit = (langId: string, lines: number) => {
		const existing = languages[langId];
		if (existing) {
			existing.total += lines;
		} else {
			languages[langId] = { total: lines };
		}
		total += lines;
	};

	for (const file of files) {
		if (signal?.aborted) throw new Error('Cancelled');
		if (shouldSkip(file.path)) continue;

		const ext = getExtension(file.path).toLowerCase();
		const lang = extensionMap.get(ext);

		// Check blob result cache first
		const cacheKey = makeBlobCacheKey(file.oid, file.path);
		const cached = blobCache.get(cacheKey);
		if (cached) {
			if (cached.languageId) {
				if (cached.testLines > 0 || cached.lines - cached.testLines > 0) {
					addToLanguage(cached.languageId, cached.lines - cached.testLines, cached.testLines);
				}
			}
			continue;
		}

		// Read blob content (use content cache for OID dedup)
		let content = contentCache.get(file.oid);
		if (content === undefined) {
			try {
				const { blob } = await git.readBlob({ fs, dir, oid: file.oid });
				if (isBinary(blob)) {
					// Cache as empty/skipped
					blobCache.set(cacheKey, { lines: 0, testLines: 0, languageId: undefined });
					continue;
				}
				content = new TextDecoder().decode(blob);
				contentCache.set(file.oid, content);
			} catch {
				continue;
			}
		}

		const lines = countLines(content);
		const basename = getBasename(file.path);

		if (!lang) {
			// Unknown extension: skip (don't add to any bucket)
			blobCache.set(cacheKey, { lines, testLines: 0, languageId: undefined });
			continue;
		}

		const langId = lang.id;

		// Classify prod vs test
		const classification = classifyFile(file.path, basename, content, lines, lang);

		blobCache.set(cacheKey, {
			lines: classification.lines,
			testLines: classification.testLines,
			languageId: langId
		});

		if (classification.hasSplit) {
			addToLanguage(
				langId,
				classification.lines - classification.testLines,
				classification.testLines
			);
		} else {
			addToLanguageNoSplit(langId, classification.lines);
		}
	}

	return { date, total, languages, comments: messages };
};

interface Classification {
	lines: number;
	testLines: number;
	hasSplit: boolean;
}

const classifyFile = (
	filePath: string,
	basename: string,
	content: string,
	lines: number,
	lang: LanguageDefinition
): Classification => {
	// 1. Inline test detection (e.g., Rust #[cfg(test)])
	if (lang.countInlineTestLines) {
		const testLines = lang.countInlineTestLines(content);
		return { lines, testLines, hasSplit: true };
	}

	// 2. Test file pattern matching
	if (lang.testFilePatterns && isTestFile(basename, lang.testFilePatterns)) {
		return { lines, testLines: lines, hasSplit: true };
	}

	// 3. Test directory matching
	const dirPatterns = lang.testDirPatterns ?? defaultTestDirPatterns;
	if (isInTestDir(filePath, dirPatterns)) {
		return { lines, testLines: lines, hasSplit: true };
	}

	// 4. Default: all prod (if language has any test heuristic, mark as prod)
	const hasTestHeuristic = !!(
		lang.testFilePatterns ||
		lang.testDirPatterns ||
		lang.countInlineTestLines
	);
	if (hasTestHeuristic) {
		return { lines, testLines: 0, hasSplit: true };
	}

	// No test heuristic at all: no prod/test split
	return { lines, testLines: 0, hasSplit: false };
};
