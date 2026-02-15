import git, { type FsClient, type HttpClient } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { ProgressEvent } from '../types';

const defaultCorsProxy = 'https://cors.isomorphic-git.org';
const sizeWarningThreshold = 1_073_741_824; // 1 GB

/** Wrap the isomorphic-git HTTP client to abort requests when signal fires */
const makeAbortableHttp = (signal?: AbortSignal): HttpClient => {
	if (!signal) return http;
	return {
		request: (args) => {
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
			return http.request(args);
		}
	};
};

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
	const refs = await git.listServerRefs({
		http,
		corsProxy: options.corsProxy ?? defaultCorsProxy,
		url: options.url,
		prefix: 'HEAD',
		symrefs: true,
		protocolVersion: 2
	});
	// Find HEAD's symref target (e.g. "refs/heads/main")
	const head = refs.find((r) => r.ref === 'HEAD');
	if (head?.target) {
		// Strip "refs/heads/" prefix to get the branch name
		return head.target.replace(/^refs\/heads\//, '');
	}
	// Fallback: list all branches and try common names
	const allRefs = await git.listServerRefs({
		http,
		corsProxy: options.corsProxy ?? defaultCorsProxy,
		url: options.url,
		prefix: 'refs/heads/',
		protocolVersion: 2
	});
	const branchNames = new Set(allRefs.map((r) => r.ref.replace(/^refs\/heads\//, '')));
	if (branchNames.has('main')) return 'main';
	if (branchNames.has('master')) return 'master';
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

	const abortableHttp = makeAbortableHttp(signal);
	let sizeWarningEmitted = false;

	await git.clone({
		fs,
		http: abortableHttp,
		dir,
		url,
		corsProxy: corsProxy ?? defaultCorsProxy,
		singleBranch: true,
		ref: defaultBranch,
		onProgress: (event) => {
			if (signal?.aborted) return;
			const total = event.total ?? 0;
			onProgress?.({
				type: 'clone',
				phase: event.phase,
				loaded: event.loaded,
				total
			});
			if (!sizeWarningEmitted && total > sizeWarningThreshold) {
				sizeWarningEmitted = true;
				onProgress?.({ type: 'size-warning', estimatedBytes: total });
			}
		},
		onAuth: () => ({ cancel: true })
	});
};

/** Fetch new commits for an already-cloned repository */
export const fetchRepo = async (
	options: CloneOptions & { defaultBranch: string }
): Promise<void> => {
	const { fs, dir, url, corsProxy, defaultBranch, onProgress, signal } = options;

	const abortableHttp = makeAbortableHttp(signal);

	await git.fetch({
		fs,
		http: abortableHttp,
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
