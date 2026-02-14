import git, { type FsClient } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { ProgressEvent } from '../types';

const defaultCorsProxy = 'https://cors.isomorphic-git.org';

export interface CloneOptions {
	fs: FsClient;
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
	const info = await git.getRemoteInfo({
		http,
		corsProxy: options.corsProxy ?? defaultCorsProxy,
		url: options.url
	});
	// HEAD is the default branch name
	if (info.HEAD) {
		return info.HEAD;
	}
	// Fallback: try common names
	const heads = info.heads ?? {};
	if ('main' in heads) return 'main';
	if ('master' in heads) return 'master';
	throw new Error('Could not detect default branch');
};

/** Clone a repository using isomorphic-git with progress and cancellation support */
export const cloneRepo = async (
	options: CloneOptions & { defaultBranch: string }
): Promise<void> => {
	const { fs, dir, url, corsProxy, defaultBranch, onProgress, signal } = options;

	// Ensure directory exists (lightning-fs supports promises.mkdir)
	try {
		const pfs = (
			fs as unknown as {
				promises: { mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void> };
			}
		).promises;
		await pfs.mkdir(dir, { recursive: true });
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
