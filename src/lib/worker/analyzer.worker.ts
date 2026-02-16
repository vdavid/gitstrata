import { Buffer } from 'buffer';
// isomorphic-git expects Buffer to be globally available in the browser
(globalThis as unknown as Record<string, unknown>).Buffer = Buffer;

import * as Comlink from 'comlink';
import git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import { configureSync, getConsoleSink, getLogger } from '@logtape/logtape';
import type { AnalysisResult, DayStats, ErrorKind, ProgressEvent } from '../types';
import { cloneRepo, detectDefaultBranch, fetchRepo, waitForBodyCleanups } from '../git/clone';
import { fillDateGaps, getCommitsByDate } from '../git/history';
import { countLinesForCommit, countLinesForCommitIncremental } from '../git/count';
import type { FileState } from '../git/count';
import { parseRepoUrl, repoToDir } from '../url';

// Configure LogTape for the worker context
configureSync({
	sinks: { console: getConsoleSink() },
	loggers: [{ category: 'git-strata', lowestLevel: 'debug', sinks: ['console'] }]
});

const logger = getLogger(['git-strata', 'pipeline']);

type ProgressCallback = (event: ProgressEvent) => void;

const classifyError = (error: unknown): { message: string; kind: ErrorKind } => {
	const raw = error instanceof Error ? error.message : String(error);
	const lower = raw.toLowerCase();

	if (lower.includes('404') || lower.includes('not found'))
		return {
			message: "Couldn't find this repository. Check the URL and make sure it's public.",
			kind: 'not-found'
		};

	if (lower.includes('401') || lower.includes('403') || lower.includes('auth'))
		return {
			message:
				'This looks like a private repository. Git strata only supports public repos for now.',
			kind: 'auth-required'
		};

	if (
		lower.includes('cors') ||
		lower.includes('failed to fetch') ||
		lower.includes('load failed') ||
		lower.includes('networkerror')
	) {
		if (lower.includes('network') || lower.includes('offline') || lower.includes('lost'))
			return {
				message:
					'Network connection lost. Your partial download is saved — reconnect and try again.',
				kind: 'network-lost'
			};
		return {
			message: 'Our download proxy is temporarily unavailable. Please try again in a moment.',
			kind: 'cors-proxy-down'
		};
	}

	if (lower.includes('quota') || lower.includes('storage') || lower.includes('indexeddb'))
		return {
			message: "Your browser's storage is full. Clear some cached repos in the footer menu.",
			kind: 'indexeddb-full'
		};

	if (lower.includes('abort') || lower.includes('cancel'))
		return { message: 'Analysis cancelled.', kind: 'cancelled' };

	return { message: raw, kind: 'unknown' };
};

let abortController: AbortController | undefined;

const analyzerApi = {
	async cancel() {
		abortController?.abort();
		await waitForBodyCleanups();
	},

	async analyze(
		repoInput: string,
		corsProxy: string,
		onProgress: ProgressCallback
	): Promise<AnalysisResult> {
		abortController = new AbortController();
		const signal = abortController.signal;
		const parsed = parseRepoUrl(repoInput);
		const dir = repoToDir(parsed);

		// Initialize lightning-fs with a unique name for persistence
		const fsName = `git-strata-${parsed.host}-${parsed.owner}-${parsed.repo}`;
		const fs = new LightningFS(fsName);

		try {
			// Step 1: Detect default branch
			onProgress({ type: 'clone', phase: 'Detecting default branch...', loaded: 0, total: 0 });
			logger.info('Starting: detect default branch for {url}', { url: parsed.url });
			const defaultBranch = await detectDefaultBranch({
				url: parsed.url,
				corsProxy,
				signal
			});
			logger.info('Detected branch: {branch}', { branch: defaultBranch });

			if (signal.aborted) throw new Error('Cancelled');

			// Step 2: Clone — emit a transition so the UI advances past "Detect branch"
			onProgress({ type: 'clone', phase: 'Counting objects', loaded: 0, total: 0 });
			logger.info('Starting: clone {url} ({branch})', {
				url: parsed.url,
				branch: defaultBranch
			});
			await cloneRepo({
				fs,
				dir,
				url: parsed.url,
				corsProxy,
				defaultBranch,
				onProgress,
				signal
			});
			logger.info('Clone complete');

			if (signal.aborted) throw new Error('Cancelled');

			// Resolve HEAD OID for freshness checking
			const headCommit = await git.resolveRef({ fs, dir, ref: defaultBranch });

			// Step 3: Get commit history grouped by date
			onProgress({ type: 'process', current: 0, total: 0, date: 'Loading history...' });
			const gitCache = {};
			const dailyCommits = await getCommitsByDate({
				fs,
				dir,
				ref: defaultBranch,
				gitCache,
				signal,
				onProgress: (processed) => {
					onProgress({
						type: 'process',
						current: 0,
						total: 0,
						date: `Loading history... (${processed.toLocaleString()} commits)`
					});
				}
			});

			if (dailyCommits.length === 0) {
				throw new Error('No commits found in repository');
			}

			// Step 4: Fill date gaps
			const allDays = fillDateGaps(dailyCommits);
			const totalDays = allDays.length;

			// Step 5: Process each day
			logger.info('Starting: analyze ({totalDays} days)', { totalDays });
			const blobCache = new Map<
				string,
				{ lines: number; testLines: number; languageId: string | undefined }
			>();
			const contentCache = new Map<string, string>();
			const treeCache = new Map<string, { path: string; oid: string; type: string }[]>();
			const fileStateMap = new Map<string, FileState>();
			const allExtensions = new Set<string>();
			let prevCommitOid: string | undefined;
			const days: DayStats[] = [];
			let prevDay: DayStats | undefined;

			for (let i = 0; i < allDays.length; i++) {
				if (signal.aborted) throw new Error('Cancelled');

				const { date, commit } = allDays[i];

				onProgress({ type: 'process', current: i + 1, total: totalDays, date });

				let dayStats: DayStats;

				if (commit) {
					if (prevCommitOid) {
						dayStats = await countLinesForCommitIncremental(
							{
								fs,
								dir,
								commitOid: commit.hash,
								prevCommitOid,
								blobCache,
								contentCache,
								treeCache,
								gitCache,
								signal
							},
							fileStateMap,
							allExtensions,
							date,
							commit.messages
						);
					} else {
						dayStats = await countLinesForCommit(
							{
								fs,
								dir,
								commitOid: commit.hash,
								blobCache,
								contentCache,
								fileStateMap,
								allExtensions,
								treeCache,
								gitCache,
								signal
							},
							date,
							commit.messages
						);
					}
					prevCommitOid = commit.hash;
					prevDay = dayStats;
				} else if (prevDay) {
					// Gap day: carry forward previous stats
					dayStats = {
						date,
						total: prevDay.total,
						languages: Object.fromEntries(
							Object.entries(prevDay.languages).map(([k, v]) => [k, { ...v }])
						),
						comments: ['-']
					};
				} else {
					continue;
				}

				days.push(dayStats);
				onProgress({ type: 'day-result', day: dayStats });
			}

			logger.info('Analysis complete ({count} days)', { count: days.length });

			// Step 6: Determine detected languages sorted by final-day line count
			const lastDay = days[days.length - 1];
			const detectedLanguages = Object.entries(lastDay.languages)
				.sort(([, a], [, b]) => b.total - a.total)
				.map(([id]) => id);

			const result: AnalysisResult = {
				repoUrl: parsed.url,
				defaultBranch,
				headCommit,
				analyzedAt: new Date().toISOString(),
				detectedLanguages,
				days
			};

			onProgress({ type: 'done', result });
			return result;
		} catch (error) {
			const classified = classifyError(error);
			logger.error('Pipeline error: {kind} — {message}', {
				kind: classified.kind,
				message: classified.message
			});
			onProgress({ type: 'error', message: classified.message, kind: classified.kind });
			throw error;
		}
	},

	async analyzeIncremental(
		repoInput: string,
		corsProxy: string,
		cachedResult: AnalysisResult,
		onProgress: ProgressCallback
	): Promise<AnalysisResult> {
		abortController = new AbortController();
		const signal = abortController.signal;
		const parsed = parseRepoUrl(repoInput);
		const dir = repoToDir(parsed);
		const fsName = `git-strata-${parsed.host}-${parsed.owner}-${parsed.repo}`;
		const fs = new LightningFS(fsName);
		const defaultBranch = cachedResult.defaultBranch;

		try {
			// Step 1: Fetch new commits (incremental, not a full clone)
			onProgress({ type: 'clone', phase: 'Fetching new commits', loaded: 0, total: 0 });
			onProgress({ type: 'clone', phase: 'Counting objects', loaded: 0, total: 0 });
			logger.info('Starting: fetch {url} ({branch})', {
				url: parsed.url,
				branch: defaultBranch
			});
			await fetchRepo({ fs, dir, url: parsed.url, corsProxy, defaultBranch, onProgress, signal });
			logger.info('Fetch complete');

			if (signal.aborted) throw new Error('Cancelled');

			// Resolve HEAD OID for freshness checking
			const headCommit = await git.resolveRef({ fs, dir, ref: defaultBranch });

			// Step 2: Get full commit history
			onProgress({ type: 'process', current: 0, total: 0, date: 'Loading history...' });
			const gitCache = {};
			const dailyCommits = await getCommitsByDate({
				fs,
				dir,
				ref: defaultBranch,
				gitCache,
				signal,
				onProgress: (processed) => {
					onProgress({
						type: 'process',
						current: 0,
						total: 0,
						date: `Loading history... (${processed.toLocaleString()} commits)`
					});
				}
			});

			if (dailyCommits.length === 0) {
				throw new Error('No commits found in repository');
			}

			// Step 3: Find last cached date
			const lastCachedDate =
				cachedResult.days.length > 0 ? cachedResult.days[cachedResult.days.length - 1].date : '';

			// Step 4: Fill date gaps for full history
			const allDays = fillDateGaps(dailyCommits);

			// Step 5: Only process days after the last cached date
			const newDayEntries = allDays.filter((d) => d.date > lastCachedDate);

			if (newDayEntries.length === 0) {
				// No new commits — return cached result with updated timestamp
				const result: AnalysisResult = {
					...cachedResult,
					headCommit,
					analyzedAt: new Date().toISOString()
				};
				onProgress({ type: 'done', result });
				return result;
			}

			// Step 6: Process only new days
			logger.info('Starting: analyze incremental ({totalDays} new days)', {
				totalDays: newDayEntries.length
			});
			const blobCache = new Map<
				string,
				{ lines: number; testLines: number; languageId: string | undefined }
			>();
			const contentCache = new Map<string, string>();
			const treeCache = new Map<string, { path: string; oid: string; type: string }[]>();
			const fileStateMap = new Map<string, FileState>();
			const allExtensions = new Set<string>();

			// Initialize from last cached commit so the first new commit
			// uses incremental tree diffing instead of a full tree walk
			const lastCachedCommitEntry = allDays
				.filter((d) => d.date <= lastCachedDate && d.commit)
				.at(-1);
			let prevCommitOid: string | undefined;
			if (lastCachedCommitEntry?.commit) {
				await countLinesForCommit(
					{
						fs,
						dir,
						commitOid: lastCachedCommitEntry.commit.hash,
						blobCache,
						contentCache,
						fileStateMap,
						allExtensions,
						treeCache,
						gitCache,
						signal
					},
					lastCachedCommitEntry.date,
					[]
				);
				prevCommitOid = lastCachedCommitEntry.commit.hash;
			}

			const newDays: DayStats[] = [];
			// Use last cached day as prevDay for gap-filling
			let prevDay: DayStats | undefined =
				cachedResult.days.length > 0 ? cachedResult.days[cachedResult.days.length - 1] : undefined;
			const totalDays = newDayEntries.length;

			for (let i = 0; i < newDayEntries.length; i++) {
				if (signal.aborted) throw new Error('Cancelled');

				const { date, commit } = newDayEntries[i];
				onProgress({ type: 'process', current: i + 1, total: totalDays, date });

				let dayStats: DayStats;

				if (commit) {
					if (prevCommitOid) {
						dayStats = await countLinesForCommitIncremental(
							{
								fs,
								dir,
								commitOid: commit.hash,
								prevCommitOid,
								blobCache,
								contentCache,
								treeCache,
								gitCache,
								signal
							},
							fileStateMap,
							allExtensions,
							date,
							commit.messages
						);
					} else {
						dayStats = await countLinesForCommit(
							{
								fs,
								dir,
								commitOid: commit.hash,
								blobCache,
								contentCache,
								fileStateMap,
								allExtensions,
								treeCache,
								gitCache,
								signal
							},
							date,
							commit.messages
						);
					}
					prevCommitOid = commit.hash;
					prevDay = dayStats;
				} else if (prevDay) {
					dayStats = {
						date,
						total: prevDay.total,
						languages: Object.fromEntries(
							Object.entries(prevDay.languages).map(([k, v]) => [k, { ...v }])
						),
						comments: ['-']
					};
				} else {
					continue;
				}

				newDays.push(dayStats);
				onProgress({ type: 'day-result', day: dayStats });
			}

			logger.info('Analysis complete ({count} days)', { count: newDays.length });

			// Step 7: Merge cached days with new days
			const mergedDays = [...cachedResult.days, ...newDays];
			const lastDay = mergedDays[mergedDays.length - 1];
			const detectedLanguages = Object.entries(lastDay.languages)
				.sort(([, a], [, b]) => b.total - a.total)
				.map(([id]) => id);

			const result: AnalysisResult = {
				repoUrl: parsed.url,
				defaultBranch,
				headCommit,
				analyzedAt: new Date().toISOString(),
				detectedLanguages,
				days: mergedDays
			};

			onProgress({ type: 'done', result });
			return result;
		} catch (error) {
			const classified = classifyError(error);
			logger.error('Pipeline error: {kind} — {message}', {
				kind: classified.kind,
				message: classified.message
			});
			onProgress({ type: 'error', message: classified.message, kind: classified.kind });
			throw error;
		}
	}
};

export type AnalyzerApi = typeof analyzerApi;

Comlink.expose(analyzerApi);
