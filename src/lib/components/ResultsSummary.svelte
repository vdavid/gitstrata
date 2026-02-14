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

	const formatNumber = (n: number): string => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return String(n);
	};

	const totalLines = $derived(days.length > 0 ? days[days.length - 1].total : 0);

	const growth = $derived.by(() => {
		if (days.length < 2) return { absolute: 0, percentage: 0 };
		const first = days[0].total;
		const last = days[days.length - 1].total;
		const absolute = last - first;
		const percentage = first > 0 ? ((last - first) / first) * 100 : 0;
		return { absolute, percentage };
	});

	const dominantLanguage = $derived(detectedLanguages.length > 0 ? detectedLanguages[0] : '');

	const avgDailyGrowth = $derived.by(() => {
		if (days.length < 2) return 0;
		const first = days[0];
		const last = days[days.length - 1];
		const daysBetween = Math.max(
			1,
			(new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24)
		);
		return Math.round((last.total - first.total) / daysBetween);
	});

	const dateRange = $derived.by(() => {
		if (days.length === 0) return '';
		const first = days[0].date;
		const last = days[days.length - 1].date;
		return `${first} to ${last}`;
	});

	const stats = $derived([
		{
			label: 'Total lines',
			value: formatNumber(totalLines),
			detail: undefined as string | undefined
		},
		{
			label: 'Growth',
			value: `${growth.absolute >= 0 ? '+' : ''}${formatNumber(growth.absolute)}`,
			detail: `${growth.percentage >= 0 ? '+' : ''}${growth.percentage.toFixed(0)}%`
		},
		{
			label: 'Top language',
			value: dominantLanguage ? langName(dominantLanguage) : '--',
			detail: undefined
		},
		{
			label: 'Avg. daily growth',
			value: `${avgDailyGrowth >= 0 ? '+' : ''}${formatNumber(avgDailyGrowth)}`,
			detail: 'lines/day'
		},
		{
			label: 'Date range',
			value: dateRange || '--',
			detail: undefined
		}
	]);
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="region" aria-label="Summary statistics">
	{#each stats as stat}
		<div
			class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4"
		>
			<p class="text-xs font-medium tracking-wide text-[var(--color-text-tertiary)] uppercase">
				{stat.label}
			</p>
			<p class="mt-1 text-lg font-semibold text-[var(--color-text)]">
				{stat.value}
			</p>
			{#if stat.detail}
				<p class="text-xs text-[var(--color-text-secondary)]">{stat.detail}</p>
			{/if}
		</div>
	{/each}
</div>
