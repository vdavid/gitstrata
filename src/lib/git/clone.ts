import git, { type FsClient, type HttpClient } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { getLogger } from '@logtape/logtape';
import type { ProgressEvent } from '../types';

const defaultCorsProxy = 'https://cors.isomorphic-git.org';
const sizeWarningThreshold = 1_073_741_824; // 1 GB

const httpLogger = getLogger(['git-strata', 'http']);
const cloneLogger = getLogger(['git-strata', 'clone']);

const makeAbortableHttp = (signal?: AbortSignal): HttpClient => ({
	request: async (args) => {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		httpLogger.info('Request: {method} {url}', {
			method: args.method ?? 'GET',
			url: args.url
		});
		const response = await http.request(args);
		httpLogger.info('Response: {statusCode}', { statusCode: response.statusCode });
		return response;
	}
});

interface CloneOptions {
	fs: FsClient;
	dir: string;
	url: string;
	corsProxy?: string;
	onProgress?: (event: ProgressEvent) => void;
	signal?: AbortSignal;
}

export const detectDefaultBranch = async (options: {
	url: string;
	corsProxy?: string;
}): Promise<string> => {
	cloneLogger.info('Detecting default branch...');
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
	cloneLogger.error('Failed to detect default branch — no main or master found');
	throw new Error('Could not detect default branch');
};

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

	// Progress logging state
	let prevPhase = '';
	let phaseTickCount = 0;

	// Staleness health check
	let lastProgressTime = Date.now();
	const stalenessTimer = setInterval(() => {
		const silentMs = Date.now() - lastProgressTime;
		if (silentMs > 60_000) {
			cloneLogger.error('Clone stale: no progress for {seconds}s — connection may be stuck', {
				seconds: Math.round(silentMs / 1000)
			});
		} else if (silentMs > 30_000) {
			cloneLogger.warning(
				'Clone slow: no progress for {seconds}s — server may be packing objects',
				{ seconds: Math.round(silentMs / 1000) }
			);
		}
	}, 10_000);

	try {
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

				// Reset staleness timer
				lastProgressTime = Date.now();

				// Sampled progress logging
				if (event.phase !== prevPhase) {
					cloneLogger.info('Clone progress: phase={phase} loaded={loaded} total={total}', {
						phase: event.phase,
						loaded: event.loaded,
						total
					});
					prevPhase = event.phase;
					phaseTickCount = 0;
				} else {
					phaseTickCount++;
					if (phaseTickCount % 10 === 0 || (total > 0 && event.loaded >= total)) {
						cloneLogger.info('Clone progress: phase={phase} loaded={loaded} total={total}', {
							phase: event.phase,
							loaded: event.loaded,
							total
						});
					}
				}

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
	} finally {
		clearInterval(stalenessTimer);
	}
};

export const fetchRepo = async (
	options: CloneOptions & { defaultBranch: string }
): Promise<void> => {
	const { fs, dir, url, corsProxy, defaultBranch, onProgress, signal } = options;

	const abortableHttp = makeAbortableHttp(signal);

	// Progress logging state
	let prevPhase = '';
	let phaseTickCount = 0;

	// Staleness health check
	let lastProgressTime = Date.now();
	const stalenessTimer = setInterval(() => {
		const silentMs = Date.now() - lastProgressTime;
		if (silentMs > 60_000) {
			cloneLogger.error('Fetch stale: no progress for {seconds}s — connection may be stuck', {
				seconds: Math.round(silentMs / 1000)
			});
		} else if (silentMs > 30_000) {
			cloneLogger.warning(
				'Fetch slow: no progress for {seconds}s — server may be packing objects',
				{ seconds: Math.round(silentMs / 1000) }
			);
		}
	}, 10_000);

	try {
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
				const total = event.total ?? 0;

				// Reset staleness timer
				lastProgressTime = Date.now();

				// Sampled progress logging
				if (event.phase !== prevPhase) {
					cloneLogger.info('Fetch progress: phase={phase} loaded={loaded} total={total}', {
						phase: event.phase,
						loaded: event.loaded,
						total
					});
					prevPhase = event.phase;
					phaseTickCount = 0;
				} else {
					phaseTickCount++;
					if (phaseTickCount % 10 === 0 || (total > 0 && event.loaded >= total)) {
						cloneLogger.info('Fetch progress: phase={phase} loaded={loaded} total={total}', {
							phase: event.phase,
							loaded: event.loaded,
							total
						});
					}
				}

				onProgress?.({
					type: 'clone',
					phase: event.phase,
					loaded: event.loaded,
					total
				});
			},
			onAuth: () => ({ cancel: true })
		});
	} finally {
		clearInterval(stalenessTimer);
	}
};
