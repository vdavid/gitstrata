import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { ProgressEvent } from '../types';

const defaultCorsProxy = 'https://cors.isomorphic-git.org';

export interface CloneOptions {
	fs: typeof import('@isomorphic-git/lightning-fs').default.prototype;
	dir: string;
	url: string;
	corsProxy?: string;
	onProgress?: (event: ProgressEvent) => void;
	signal?: AbortSignal;
}

/** Detect the default branch (HEAD symref) of a remote repository */
export const detectDefaultBranch = async (options: {
	url: string;
	corsProxy?: string;
}): Promise<string> => {
	const info = await git.getRemoteInfo2({
		http,
		corsProxy: options.corsProxy ?? defaultCorsProxy,
		url: options.url
	});
	// HEAD symref is the default branch
	if (info.HEAD) {
		return info.HEAD;
	}
	// Fallback: try common names
	const refs = info.refs?.heads ?? {};
	if ('main' in refs) return 'main';
	if ('master' in refs) return 'master';
	throw new Error('Could not detect default branch');
};

/** Clone a repository using isomorphic-git with progress and cancellation support */
export const cloneRepo = async (
	options: CloneOptions & { defaultBranch: string }
): Promise<void> => {
	const { fs, dir, url, corsProxy, defaultBranch, onProgress, signal } = options;

	// Ensure directory exists
	try {
		await fs.promises.mkdir(dir, { recursive: true });
	} catch {
		// Directory may already exist
	}

	await git.clone({
		fs,
		http,
		dir,
		url,
		corsProxy: corsProxy ?? defaultCorsProxy,
		singleBranch: true,
		ref: defaultBranch,
		onProgress: (event) => {
			if (signal?.aborted) return;
			onProgress?.({
				type: 'clone',
				phase: event.phase,
				loaded: event.loaded,
				total: event.total ?? 0
			});
		},
		onAuth: () => ({ cancel: true })
	});
};

/** Fetch new commits for an already-cloned repository */
export const fetchRepo = async (
	options: CloneOptions & { defaultBranch: string }
): Promise<void> => {
	const { fs, dir, url, corsProxy, defaultBranch, onProgress, signal } = options;

	await git.fetch({
		fs,
		http,
		dir,
		url,
		corsProxy: corsProxy ?? defaultCorsProxy,
		singleBranch: true,
		ref: defaultBranch,
		onProgress: (event) => {
			if (signal?.aborted) return;
			onProgress?.({
				type: 'clone',
				phase: event.phase,
				loaded: event.loaded,
				total: event.total ?? 0
			});
		},
		onAuth: () => ({ cancel: true })
	});
};
