import * as Comlink from 'comlink';
import LightningFS from '@isomorphic-git/lightning-fs';
import type { AnalysisResult, DayStats, ErrorKind, ProgressEvent } from '../types';
import { cloneRepo, detectDefaultBranch, fetchRepo } from '../git/clone';
import { fillDateGaps, getCommitsByDate } from '../git/history';
import { countLinesForCommit } from '../git/count';
import { parseRepoUrl, repoToDir } from '../url';

type ProgressCallback = (event: ProgressEvent) => void;

/** Classify an error into a user-friendly category */
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
			message:
				'Our download proxy is temporarily unavailable. Please try again in a moment.',
			kind: 'cors-proxy-down'
		};
	}

	if (lower.includes('quota') || lower.includes('storage') || lower.includes('indexeddb'))
		return {
			message:
				"Your browser's storage is full. Clear some cached repos in the footer menu.",
			kind: 'indexeddb-full'
		};

	if (lower.includes('abort') || lower.includes('cancel'))
		return { message: 'Analysis cancelled.', kind: 'cancelled' };

	return { message: raw, kind: 'unknown' };
};

let cancelled = false;

const analyzerApi = {
	cancel() {
		cancelled = true;
	},

	async analyze(
		repoInput: string,
		corsProxy: string | undefined,
		onProgress: ProgressCallback
	): Promise<AnalysisResult> {
		cancelled = false;
		const parsed = parseRepoUrl(repoInput);
		const dir = repoToDir(parsed);

		// Initialize lightning-fs with a unique name for persistence
		const fsName = `git-strata-${parsed.host}-${parsed.owner}-${parsed.repo}`;
		const lfs = new LightningFS(fsName);
		const fs = lfs;

		try {
			// Step 1: Detect default branch
			onProgress({ type: 'clone', phase: 'Detecting default branch...', loaded: 0, total: 0 });
			const defaultBranch = await detectDefaultBranch({
				url: parsed.url,
				corsProxy
			});

			if (cancelled) throw new Error('Cancelled');

			// Step 2: Clone
			await cloneRepo({
				fs,
				dir,
				url: parsed.url,
				corsProxy,
				defaultBranch,
				onProgress
			});

			if (cancelled) throw new Error('Cancelled');

			// Step 3: Get commit history grouped by date
			onProgress({ type: 'process', current: 0, total: 0, date: 'Loading history...' });
			const dailyCommits = await getCommitsByDate({ fs, dir, ref: defaultBranch });

			if (dailyCommits.length === 0) {
				throw new Error('No commits found in repository');
			}

			// Step 4: Fill date gaps
			const allDays = fillDateGaps(dailyCommits);
			const totalDays = allDays.length;

			// Step 5: Process each day
			const blobCache = new Map<
				string,
				{ lines: number; testLines: number; languageId: string | undefined }
			>();
			const contentCache = new Map<string, string>();
			const days: DayStats[] = [];
			let prevDay: DayStats | undefined;

			for (let i = 0; i < allDays.length; i++) {
				if (cancelled) throw new Error('Cancelled');

				const { date, commit } = allDays[i];

				onProgress({ type: 'process', current: i + 1, total: totalDays, date });

				let dayStats: DayStats;

				if (commit) {
					dayStats = await countLinesForCommit(
						{ fs, dir, commitOid: commit.hash, blobCache, contentCache },
						date,
						commit.messages
					);
					prevDay = dayStats;
				} else if (prevDay) {
					// Gap day: carry forward previous stats
					dayStats = {
						date,
						total: prevDay.total,
						languages: { ...prevDay.languages },
						comments: ['-']
					};
				} else {
					continue;
				}

				days.push(dayStats);
				onProgress({ type: 'day-result', day: dayStats });
			}

			// Step 6: Determine detected languages sorted by final-day line count
			const lastDay = days[days.length - 1];
			const detectedLanguages = Object.entries(lastDay.languages)
				.sort(([, a], [, b]) => b.total - a.total)
				.map(([id]) => id);

			const result: AnalysisResult = {
				repoUrl: parsed.url,
				defaultBranch,
				analyzedAt: new Date().toISOString(),
				detectedLanguages,
				days
			};

			onProgress({ type: 'done', result });
			return result;
		} catch (error) {
			const classified = classifyError(error);
			onProgress({ type: 'error', message: classified.message, kind: classified.kind });
			throw error;
		}
	},

	async analyzeIncremental(
		repoInput: string,
		corsProxy: string | undefined,
		cachedResult: AnalysisResult,
		onProgress: ProgressCallback
	): Promise<AnalysisResult> {
		cancelled = false;
		const parsed = parseRepoUrl(repoInput);
		const dir = repoToDir(parsed);
		const fsName = `git-strata-${parsed.host}-${parsed.owner}-${parsed.repo}`;
		const fs = new LightningFS(fsName);
		const defaultBranch = cachedResult.defaultBranch;

		try {
			// Step 1: Fetch new commits (incremental, not a full clone)
			onProgress({ type: 'clone', phase: 'Fetching new commits...', loaded: 0, total: 0 });
			await fetchRepo({ fs, dir, url: parsed.url, corsProxy, defaultBranch, onProgress });

			if (cancelled) throw new Error('Cancelled');

			// Step 2: Get full commit history
			onProgress({ type: 'process', current: 0, total: 0, date: 'Loading history...' });
			const dailyCommits = await getCommitsByDate({ fs, dir, ref: defaultBranch });

			if (dailyCommits.length === 0) {
				throw new Error('No commits found in repository');
			}

			// Step 3: Find last cached date
			const lastCachedDate =
				cachedResult.days.length > 0
					? cachedResult.days[cachedResult.days.length - 1].date
					: '';

			// Step 4: Fill date gaps for full history
			const allDays = fillDateGaps(dailyCommits);

			// Step 5: Only process days after the last cached date
			const newDayEntries = allDays.filter((d) => d.date > lastCachedDate);

			if (newDayEntries.length === 0) {
				// No new commits — return cached result with updated timestamp
				const result: AnalysisResult = {
					...cachedResult,
					analyzedAt: new Date().toISOString()
				};
				onProgress({ type: 'done', result });
				return result;
			}

			// Step 6: Process only new days
			const blobCache = new Map<
				string,
				{ lines: number; testLines: number; languageId: string | undefined }
			>();
			const contentCache = new Map<string, string>();
			const newDays: DayStats[] = [];
			// Use last cached day as prevDay for gap-filling
			let prevDay: DayStats | undefined =
				cachedResult.days.length > 0
					? cachedResult.days[cachedResult.days.length - 1]
					: undefined;
			const totalDays = newDayEntries.length;

			for (let i = 0; i < newDayEntries.length; i++) {
				if (cancelled) throw new Error('Cancelled');

				const { date, commit } = newDayEntries[i];
				onProgress({ type: 'process', current: i + 1, total: totalDays, date });

				let dayStats: DayStats;

				if (commit) {
					dayStats = await countLinesForCommit(
						{ fs, dir, commitOid: commit.hash, blobCache, contentCache },
						date,
						commit.messages
					);
					prevDay = dayStats;
				} else if (prevDay) {
					dayStats = {
						date,
						total: prevDay.total,
						languages: { ...prevDay.languages },
						comments: ['-']
					};
				} else {
					continue;
				}

				newDays.push(dayStats);
				onProgress({ type: 'day-result', day: dayStats });
			}

			// Step 7: Merge cached days with new days
			const mergedDays = [...cachedResult.days, ...newDays];
			const lastDay = mergedDays[mergedDays.length - 1];
			const detectedLanguages = Object.entries(lastDay.languages)
				.sort(([, a], [, b]) => b.total - a.total)
				.map(([id]) => id);

			const result: AnalysisResult = {
				repoUrl: parsed.url,
				defaultBranch,
				analyzedAt: new Date().toISOString(),
				detectedLanguages,
				days: mergedDays
			};

			onProgress({ type: 'done', result });
			return result;
		} catch (error) {
			const classified = classifyError(error);
			onProgress({ type: 'error', message: classified.message, kind: classified.kind });
			throw error;
		}
	}
};

export type AnalyzerApi = typeof analyzerApi;

Comlink.expose(analyzerApi);
