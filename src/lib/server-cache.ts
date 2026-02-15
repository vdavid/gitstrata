import { env } from '$env/dynamic/public';
import type { AnalysisResult, SharedCacheEntry } from './types';

const getBaseUrl = (): string | undefined => env.PUBLIC_SHARED_CACHE_URL || undefined;
const getWriteToken = (): string | undefined => env.PUBLIC_CACHE_WRITE_TOKEN || undefined;

/** SHA-256 hash a string, returned as hex */
const sha256 = async (input: string): Promise<string> => {
	const data = new TextEncoder().encode(input);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Gzip-compress a string using the CompressionStream API */
const gzipCompress = async (input: string): Promise<Blob> => {
	const blob = new Blob([input]);
	const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
	return new Response(stream).blob();
};

/**
 * Fetch a cached result from the shared server cache.
 * Returns undefined on miss, error, or when the cache is disabled.
 */
export const fetchServerResult = async (repoUrl: string): Promise<SharedCacheEntry | undefined> => {
	const baseUrl = getBaseUrl();
	if (!baseUrl) return undefined;

	try {
		const repoHash = await sha256(repoUrl);
		const response = await fetch(`${baseUrl}/cache/v1/${repoHash}`);
		if (!response.ok) return undefined;
		return (await response.json()) as SharedCacheEntry;
	} catch {
		return undefined;
	}
};

/**
 * Upload a result to the shared server cache.
 * No-ops silently on error or when the cache is disabled.
 */
export const uploadServerResult = async (result: AnalysisResult): Promise<void> => {
	const baseUrl = getBaseUrl();
	if (!baseUrl) return;

	try {
		const entry: SharedCacheEntry = {
			version: 1,
			repoUrl: result.repoUrl,
			headCommit: result.headCommit,
			result,
			updatedAt: new Date().toISOString()
		};

		const repoHash = await sha256(result.repoUrl);
		const compressed = await gzipCompress(JSON.stringify(entry));

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'Content-Encoding': 'gzip'
		};
		const writeToken = getWriteToken();
		if (writeToken) {
			headers['Authorization'] = `Bearer ${writeToken}`;
		}

		await fetch(`${baseUrl}/cache/v1/${repoHash}`, {
			method: 'PUT',
			headers,
			body: compressed
		});
	} catch {
		// Silently ignore — server cache is best-effort
	}
};
