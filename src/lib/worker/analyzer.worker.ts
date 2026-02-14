import * as Comlink from 'comlink';
import LightningFS from '@isomorphic-git/lightning-fs';
import type { AnalysisResult, DayStats, ProgressEvent } from '../types';
import { cloneRepo, detectDefaultBranch } from '../git/clone';
import { fillDateGaps, getCommitsByDate } from '../git/history';
import { countLinesForCommit } from '../git/count';
import { parseRepoUrl, repoToDir } from '../url';

type ProgressCallback = (event: ProgressEvent) => void;

const analyzerApi = {
	async analyze(
		repoInput: string,
		corsProxy: string | undefined,
		onProgress: ProgressCallback
	): Promise<AnalysisResult> {
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

			// Step 2: Clone
			await cloneRepo({
				fs,
				dir,
				url: parsed.url,
				corsProxy,
				defaultBranch,
				onProgress
			});

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
			const blobCache = new Map<string, { lines: number; testLines: number; languageId: string | undefined }>();
			const contentCache = new Map<string, string>();
			const days: DayStats[] = [];
			let prevDay: DayStats | undefined;

			for (let i = 0; i < allDays.length; i++) {
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
			const message = error instanceof Error ? error.message : String(error);
			onProgress({ type: 'error', message });
			throw error;
		}
	}
};

export type AnalyzerApi = typeof analyzerApi;

Comlink.expose(analyzerApi);
