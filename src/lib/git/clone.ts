import git, { type FsClient, type HttpClient } from 'isomorphic-git';
import { getLogger } from '@logtape/logtape';
import type { ProgressEvent } from '../types';

const sizeWarningThreshold = 1_073_741_824; // 1 GB

const httpLogger = getLogger(['git-strata', 'http']);
const cloneLogger = getLogger(['git-strata', 'clone']);

const makeAbortableHttp = (signal?: AbortSignal): HttpClient => ({
	request: async ({ url, method = 'GET', headers = {}, body, onProgress }) => {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		httpLogger.info('Request: {method} {url}', { method, url });

		// Collect async iterable request body into a single buffer
		let requestBody: Uint8Array | undefined;
		if (body) {
			const chunks: Uint8Array[] = [];
			for await (const chunk of body) {
				chunks.push(chunk);
			}
			const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
			requestBody = new Uint8Array(totalLength);
			let offset = 0;
			for (const chunk of chunks) {
				requestBody.set(chunk, offset);
				offset += chunk.byteLength;
			}
		}

		const res = await fetch(url, {
			method,
			headers,
			body: requestBody as BodyInit | undefined,
			signal
		});
		httpLogger.info('Response: {statusCode}', { statusCode: res.status });

		const responseHeaders: Record<string, string> = {};
		res.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		// Stream response body as async iterable with progress tracking
		async function* iterateBody(): AsyncGenerator<Uint8Array> {
			if (!res.body) {
				const buf = new Uint8Array(await res.arrayBuffer());
				if (buf.byteLength > 0) {
					onProgress?.({ phase: 'downloading', loaded: buf.byteLength, total: 0 });
					yield buf;
				}
				return;
			}
			const reader = res.body.getReader();
			let loaded = 0;
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) return;
					loaded += value.byteLength;
					onProgress?.({ phase: 'downloading', loaded, total: 0 });
					yield value;
				}
			} finally {
				reader.releaseLock();
			}
		}

		return {
			url: res.url,
			method,
			statusCode: res.status,
			statusMessage: res.statusText,
			body: iterateBody(),
			headers: responseHeaders
		};
	}
});

interface CloneOptions {
	fs: FsClient;
	dir: string;
	url: string;
	corsProxy: string;
	onProgress?: (event: ProgressEvent) => void;
	signal?: AbortSignal;
}

export const detectDefaultBranch = async (options: {
	url: string;
	corsProxy: string;
	signal?: AbortSignal;
}): Promise<string> => {
	cloneLogger.info('Detecting default branch...');
	const abortableHttp = makeAbortableHttp(options.signal);
	const refs = await git.listServerRefs({
		http: abortableHttp,
		corsProxy: options.corsProxy,
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
		http: abortableHttp,
		corsProxy: options.corsProxy,
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
			corsProxy,
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
			corsProxy,
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
