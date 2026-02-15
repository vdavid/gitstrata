<script lang="ts">
	import { getLanguages } from '$lib/languages';
	import type { DayStats } from '$lib/types';

	interface Props {
		days: DayStats[];
		detectedLanguages: string[];
	}

	let { days, detectedLanguages }: Props = $props();

	const languageNameMap = $derived.by(() => {
		const entries: [string, string][] = getLanguages().map((lang) => [lang.id, lang.name]);
		return Object.fromEntries(entries) as Record<string, string>;
	});

	const langName = (id: string): string => languageNameMap[id] ?? id;

	/** Languages that account for >= 5% of total lines at the latest point */
	const visibleLanguages = $derived.by(() => {
		if (days.length === 0) return [];
		const last = days[days.length - 1];
		const totalAtEnd = last.total || 1;
		return detectedLanguages.filter((id) => {
			const lc = last.languages[id];
			return lc && lc.total / totalAtEnd >= 0.05;
		});
	});

	const hasOther = $derived(visibleLanguages.length < detectedLanguages.length);

	type SortKey = 'date' | 'total' | 'other' | string; // string for language ids
	type SortDir = 'asc' | 'desc';

	let sortKey = $state<SortKey>('date');
	let sortDir = $state<SortDir>('asc');

	const toggleSort = (key: SortKey) => {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = key === 'date' ? 'asc' : 'desc';
		}
	};

	const getValue = (day: DayStats, key: SortKey): number | string => {
		if (key === 'date') return day.date;
		if (key === 'total') return day.total;
		if (key === 'other') {
			const shownSet = new Set(visibleLanguages);
			let sum = 0;
			for (const [id, lc] of Object.entries(day.languages)) {
				if (!shownSet.has(id)) sum += lc.total;
			}
			return sum;
		}
		return day.languages[key]?.total ?? 0;
	};

	const sortedDays = $derived.by(() => {
		const sorted = [...days];
		sorted.sort((a, b) => {
			const va = getValue(a, sortKey);
			const vb = getValue(b, sortKey);
			const cmp = va < vb ? -1 : va > vb ? 1 : 0;
			return sortDir === 'asc' ? cmp : -cmp;
		});
		return sorted;
	});

	const formatNumber = (n: number): string => n.toLocaleString();

	const sortIndicator = (key: SortKey): string => {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? ' \u2191' : ' \u2193';
	};

	const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => {
		if (sortKey !== key) return 'none';
		return sortDir === 'asc' ? 'ascending' : 'descending';
	};

	// CSV generation
	const generateCsv = (): string => {
		const columns = ['date', ...visibleLanguages.map(langName)];
		if (hasOther) columns.push('other');
		columns.push('total');

		const header = columns.join(',');
		const rows = days.map((day) => {
			const vals = [day.date];
			const shownSet = new Set(visibleLanguages);
			for (const id of visibleLanguages) {
				vals.push(String(day.languages[id]?.total ?? 0));
			}
			if (hasOther) {
				let sum = 0;
				for (const [id, lc] of Object.entries(day.languages)) {
					if (!shownSet.has(id)) sum += lc.total;
				}
				vals.push(String(sum));
			}
			vals.push(String(day.total));
			return vals.join(',');
		});

		return [header, ...rows].join('\n');
	};

	const copyCsv = async () => {
		const csv = generateCsv();
		await navigator.clipboard.writeText(csv);
		copyLabel = 'Copied!';
		setTimeout(() => (copyLabel = 'Copy CSV'), 2000);
	};

	const downloadCsv = () => {
		const csv = generateCsv();
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'loc-data.csv';
		a.click();
		URL.revokeObjectURL(url);
	};

	let copyLabel = $state('Copy CSV');

	const otherValue = (day: DayStats): number => {
		const shownSet = new Set(visibleLanguages);
		let sum = 0;
		for (const [id, lc] of Object.entries(day.languages)) {
			if (!shownSet.has(id)) sum += lc.total;
		}
		return sum;
	};
</script>

<div class="space-y-3">
	<div class="flex items-center gap-2">
		<button onclick={copyCsv} class="btn-ghost">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
				<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
			</svg>
			{copyLabel}
		</button>
		<button onclick={downloadCsv} class="btn-ghost">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
				<polyline points="7 10 12 15 17 10" />
				<line x1="12" y1="15" x2="12" y2="3" />
			</svg>
			Export CSV
		</button>
	</div>

	<div class="strata-card overflow-hidden">
		<div class="strata-scroll overflow-x-auto">
			<table class="strata-table" aria-label="Lines of code by date and language">
				<caption class="sr-only">
					Lines of code over time, sorted by {sortKey} ({sortDir === 'asc'
						? 'ascending'
						: 'descending'}). Use column headers to change sort order.
				</caption>
				<thead>
					<tr>
						<th class="text-left" scope="col" aria-sort={ariaSort('date')}>
							<button
								class="hover:text-[var(--color-text)] transition-colors"
								style="transition-duration: var(--duration-fast);"
								onclick={() => toggleSort('date')}
								aria-label={`Sort by date${ariaSort('date') !== 'none' ? ` (${ariaSort('date')})` : ''}`}
							>
								Date{sortIndicator('date')}
							</button>
						</th>
						{#each visibleLanguages as langId (langId)}
							<th class="text-right" scope="col" aria-sort={ariaSort(langId)}>
								<button
									class="hover:text-[var(--color-text)] transition-colors"
									style="transition-duration: var(--duration-fast);"
									onclick={() => toggleSort(langId)}
									aria-label={`Sort by ${langName(langId)}${ariaSort(langId) !== 'none' ? ` (${ariaSort(langId)})` : ''}`}
								>
									{langName(langId)}{sortIndicator(langId)}
								</button>
							</th>
						{/each}
						{#if hasOther}
							<th class="text-right" scope="col" aria-sort={ariaSort('other')}>
								<button
									class="hover:text-[var(--color-text)] transition-colors"
									style="transition-duration: var(--duration-fast);"
									onclick={() => toggleSort('other')}
									aria-label={`Sort by other${ariaSort('other') !== 'none' ? ` (${ariaSort('other')})` : ''}`}
								>
									Other{sortIndicator('other')}
								</button>
							</th>
						{/if}
						<th class="text-right" scope="col" aria-sort={ariaSort('total')}>
							<button
								class="hover:text-[var(--color-text)] transition-colors"
								style="transition-duration: var(--duration-fast);"
								onclick={() => toggleSort('total')}
								aria-label={`Sort by total${ariaSort('total') !== 'none' ? ` (${ariaSort('total')})` : ''}`}
							>
								Total{sortIndicator('total')}
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each sortedDays as day (day.date)}
						<tr>
							<td class="text-[var(--color-text-secondary)]">{day.date}</td>
							{#each visibleLanguages as langId (langId)}
								<td class="text-right">
									{formatNumber(day.languages[langId]?.total ?? 0)}
								</td>
							{/each}
							{#if hasOther}
								<td class="text-right text-[var(--color-text-secondary)]">
									{formatNumber(otherValue(day))}
								</td>
							{/if}
							<td class="text-right font-medium">
								{formatNumber(day.total)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
