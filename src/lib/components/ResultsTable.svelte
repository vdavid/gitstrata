<script lang="ts">
	import { getLanguages } from '$lib/languages';
	import type { DayStats } from '$lib/types';

	interface Props {
		days: DayStats[];
		detectedLanguages: string[];
	}

	let { days, detectedLanguages }: Props = $props();

	const languageNameMap = $derived.by(() => {
		const map = new Map<string, string>();
		for (const lang of getLanguages()) {
			map.set(lang.id, lang.name);
		}
		return map;
	});

	const langName = (id: string): string => languageNameMap.get(id) ?? id;

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
		<button
			onclick={copyCsv}
			class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm
				text-[var(--color-text-secondary)] transition-colors
				hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]"
		>
			{copyLabel}
		</button>
		<button
			onclick={downloadCsv}
			class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm
				text-[var(--color-text-secondary)] transition-colors
				hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]"
		>
			Download CSV
		</button>
	</div>

	<div class="overflow-x-auto rounded-xl border border-[var(--color-border)]">
		<table class="w-full text-sm" aria-label="Lines of code by date and language">
			<thead>
				<tr class="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
					<th class="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]" scope="col" aria-sort={ariaSort('date')}>
						<button
							class="hover:text-[var(--color-text)] transition-colors"
							onclick={() => toggleSort('date')}
						>
							Date{sortIndicator('date')}
						</button>
					</th>
					{#each visibleLanguages as langId}
						<th class="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]" scope="col" aria-sort={ariaSort(langId)}>
							<button
								class="hover:text-[var(--color-text)] transition-colors"
								onclick={() => toggleSort(langId)}
							>
								{langName(langId)}{sortIndicator(langId)}
							</button>
						</th>
					{/each}
					{#if hasOther}
						<th class="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]" scope="col" aria-sort={ariaSort('other')}>
							<button
								class="hover:text-[var(--color-text)] transition-colors"
								onclick={() => toggleSort('other')}
							>
								Other{sortIndicator('other')}
							</button>
						</th>
					{/if}
					<th class="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]" scope="col" aria-sort={ariaSort('total')}>
						<button
							class="hover:text-[var(--color-text)] transition-colors"
							onclick={() => toggleSort('total')}
						>
							Total{sortIndicator('total')}
						</button>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each sortedDays as day}
					<tr class="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors">
						<td class="px-3 py-2 font-mono text-[var(--color-text-secondary)]">{day.date}</td>
						{#each visibleLanguages as langId}
							<td class="px-3 py-2 text-right font-mono tabular-nums">
								{formatNumber(day.languages[langId]?.total ?? 0)}
							</td>
						{/each}
						{#if hasOther}
							<td class="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-text-secondary)]">
								{formatNumber(otherValue(day))}
							</td>
						{/if}
						<td class="px-3 py-2 text-right font-mono font-medium tabular-nums">
							{formatNumber(day.total)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
