import git, { type ReadCommitResult } from 'isomorphic-git';

/** A commit grouped by date, keeping the latest hash and all messages */
export interface DailyCommit {
	date: string; // YYYY-MM-DD
	hash: string; // OID of the latest commit that day
	messages: string[];
}

/**
 * Get the commit log for a branch and group by date.
 * Returns entries in chronological order (oldest first).
 * Keeps the latest commit hash per day but collects all messages.
 */
export const getCommitsByDate = async (options: {
	fs: typeof import('@isomorphic-git/lightning-fs').default.prototype;
	dir: string;
	ref: string;
}): Promise<DailyCommit[]> => {
	const { fs, dir, ref } = options;

	const commits: ReadCommitResult[] = await git.log({ fs, dir, ref });

	// git.log returns newest-first; group by date
	const byDate = new Map<string, DailyCommit>();

	for (const commit of commits) {
		const date = formatDate(commit.commit.author.timestamp);
		const existing = byDate.get(date);
		if (!existing) {
			// First commit for this date (latest chronologically since log is reverse order)
			byDate.set(date, {
				date,
				hash: commit.oid,
				messages: [commit.commit.message.trim()]
			});
		} else {
			existing.messages.push(commit.commit.message.trim());
		}
	}

	// Sort chronologically (oldest first)
	const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
	return sorted;
};

/** Format a unix timestamp (seconds) to YYYY-MM-DD */
const formatDate = (timestamp: number): string => {
	const d = new Date(timestamp * 1000);
	const year = d.getUTCFullYear();
	const month = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

/**
 * Generate all consecutive dates between start and end (inclusive).
 * Ported from Go reference implementation.
 */
export const generateConsecutiveDates = (startDate: string, endDate: string): string[] => {
	const start = new Date(startDate + 'T00:00:00Z');
	const end = new Date(endDate + 'T00:00:00Z');
	const dates: string[] = [];

	const current = new Date(start);
	while (current <= end) {
		const year = current.getUTCFullYear();
		const month = String(current.getUTCMonth() + 1).padStart(2, '0');
		const day = String(current.getUTCDate()).padStart(2, '0');
		dates.push(`${year}-${month}-${day}`);
		current.setUTCDate(current.getUTCDate() + 1);
	}

	return dates;
};

/**
 * Fill date gaps in daily commits.
 * For dates between commits that have no data, returns undefined
 * (the caller carries forward the previous day's stats).
 */
export const fillDateGaps = (
	dailyCommits: DailyCommit[]
): Array<{ date: string; commit: DailyCommit | undefined }> => {
	if (dailyCommits.length === 0) return [];

	const firstDate = dailyCommits[0].date;
	const lastDate = dailyCommits[dailyCommits.length - 1].date;
	const allDates = generateConsecutiveDates(firstDate, lastDate);

	const commitMap = new Map(dailyCommits.map((c) => [c.date, c]));

	return allDates.map((date) => ({
		date,
		commit: commitMap.get(date)
	}));
};
