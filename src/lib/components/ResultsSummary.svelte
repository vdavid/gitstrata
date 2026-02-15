<script lang="ts">
	import type { DayStats } from '$lib/types';

	interface Props {
		days: DayStats[];
		detectedLanguages: string[];
	}

	let { days }: Props = $props();

	// --- Total lines ---
	const totalLines = $derived(days.length > 0 ? days[days.length - 1].total : 0);

	const formattedTotal = $derived(totalLines.toLocaleString('en-US').replace(/,/g, '\u2009'));

	// --- Prod / test split ---
	const prodTestSplit = $derived.by(() => {
		if (days.length === 0) return { prod: 0, test: 0, prodPct: 0, testPct: 0 };
		const lastDay = days[days.length - 1];
		let prod = 0;
		let test = 0;
		for (const lang of Object.values(lastDay.languages)) {
			if (lang.prod !== undefined && lang.test !== undefined) {
				prod += lang.prod;
				test += lang.test;
			} else {
				// Languages without prod/test split count as prod
				prod += lang.total;
			}
		}
		const sum = prod + test;
		const prodPct = sum > 0 ? Math.round((prod / sum) * 100) : 0;
		const testPct = sum > 0 ? 100 - prodPct : 0;
		return { prod, test, prodPct, testPct };
	});

	// SVG pie chart arc path helper
	function describeArc(
		cx: number,
		cy: number,
		r: number,
		startAngle: number,
		endAngle: number
	): string {
		if (endAngle - startAngle >= 360) {
			// Full circle — use two arcs
			const mid = startAngle + 180;
			return describeArc(cx, cy, r, startAngle, mid) + ' ' + describeArc(cx, cy, r, mid, endAngle);
		}
		const startRad = ((startAngle - 90) * Math.PI) / 180;
		const endRad = ((endAngle - 90) * Math.PI) / 180;
		const x1 = cx + r * Math.cos(startRad);
		const y1 = cy + r * Math.sin(startRad);
		const x2 = cx + r * Math.cos(endRad);
		const y2 = cy + r * Math.sin(endRad);
		const largeArc = endAngle - startAngle > 180 ? 1 : 0;
		return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
	}

	const prodAngle = $derived(prodTestSplit.prodPct * 3.6);

	// --- Average growth ---
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

	const avgGrowthLast90 = $derived.by(() => {
		if (days.length < 2) return 0;
		const lastDate = new Date(days[days.length - 1].date);
		const cutoffStr = new Date(lastDate.getTime() - 90 * 24 * 60 * 60 * 1000)
			.toISOString()
			.slice(0, 10);

		// Find the first day at or after the cutoff
		let startIdx = 0;
		for (let i = 0; i < days.length; i++) {
			if (days[i].date >= cutoffStr) {
				startIdx = Math.max(0, i - 1); // include previous day for diff
				break;
			}
		}

		const startDay = days[startIdx];
		const endDay = days[days.length - 1];
		const daysBetween = Math.max(
			1,
			(new Date(endDay.date).getTime() - new Date(startDay.date).getTime()) / (1000 * 60 * 60 * 24)
		);
		return Math.round((endDay.total - startDay.total) / daysBetween);
	});

	/** Show arrow only when the difference is significant (>20%) */
	const growthTrend = $derived.by(() => {
		if (avgDailyGrowth === 0 && avgGrowthLast90 === 0) return 'neutral' as const;
		const base = Math.max(Math.abs(avgDailyGrowth), 1);
		const ratio = Math.abs(avgGrowthLast90 - avgDailyGrowth) / base;
		if (ratio <= 0.2) return 'neutral' as const;
		return avgGrowthLast90 > avgDailyGrowth ? ('up' as const) : ('down' as const);
	});

	// --- Age ---
	const monthNames = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];

	const repoAge = $derived.by(() => {
		if (days.length === 0)
			return { years: 0, months: 0, startLabel: '', isDead: false, deadSince: '' };
		const firstDate = new Date(days[0].date);
		const lastDate = new Date(days[days.length - 1].date);

		let years = lastDate.getFullYear() - firstDate.getFullYear();
		let months = lastDate.getMonth() - firstDate.getMonth();
		if (months < 0) {
			years--;
			months += 12;
		}

		const startLabel = `${monthNames[firstDate.getMonth()]} ${firstDate.getFullYear()}`;

		// Dead repo detection: find last day with actual commits (not gap-filled)
		let lastCommitDate = lastDate;
		for (let i = days.length - 1; i >= 0; i--) {
			const d = days[i];
			if (d.comments.length > 0 && !(d.comments.length === 1 && d.comments[0] === '-')) {
				lastCommitDate = new Date(d.date);
				break;
			}
		}

		const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
		const isDead = lastDate.getTime() - lastCommitDate.getTime() > sixMonthsMs;
		const deadSince = isDead
			? `${monthNames[lastCommitDate.getMonth()]} ${lastCommitDate.getFullYear()}`
			: '';

		return { years, months, startLabel, isDead, deadSince };
	});

	// --- Peak day ---
	const peakDay = $derived.by(() => {
		if (days.length < 2) return { date: '', growth: 0 };
		let maxGrowth = 0;
		let maxDate = '';
		for (let i = 1; i < days.length; i++) {
			const diff = days[i].total - days[i - 1].total;
			if (diff > maxGrowth) {
				maxGrowth = diff;
				maxDate = days[i].date;
			}
		}
		return { date: maxDate, growth: maxGrowth };
	});

	const peakDateFormatted = $derived.by(() => {
		if (!peakDay.date) return '--';
		const d = new Date(peakDay.date);
		return `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
	});

	const formatNumber = (n: number): string => n.toLocaleString('en-US').replace(/,/g, '\u2009');
</script>

<div
	class="grid grid-cols-2 auto-rows-[1fr] gap-3 sm:grid-cols-3 lg:grid-cols-5 strata-stagger"
	role="region"
	aria-label="Summary statistics"
>
	<!-- Total lines -->
	<div class="strata-card px-4 py-3.5">
		<p
			class="text-[var(--color-text-tertiary)]"
			style="font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: 0.08em; text-transform: uppercase;"
		>
			Total lines
		</p>
		<p
			class="mt-1.5 text-[var(--color-text)]"
			style="font-family: var(--font-mono); font-size: 1.125rem; font-weight: 500; letter-spacing: -0.01em;"
		>
			{formattedTotal}
		</p>
	</div>

	<!-- Prod / test split -->
	<div class="strata-card px-4 py-3.5">
		<p
			class="text-[var(--color-text-tertiary)]"
			style="font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: 0.08em; text-transform: uppercase;"
		>
			Prod / test split
		</p>
		<div class="mt-1.5 flex items-center gap-2.5">
			{#if prodTestSplit.prod + prodTestSplit.test > 0}
				<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" style="flex-shrink: 0;">
					<title
						>Prod: {prodTestSplit.prod.toLocaleString('en-US')} lines, Test: {prodTestSplit.test.toLocaleString(
							'en-US'
						)} lines</title
					>
					{#if prodTestSplit.testPct === 0}
						<circle cx="16" cy="16" r="14" fill="var(--color-accent)" />
					{:else if prodTestSplit.prodPct === 0}
						<circle cx="16" cy="16" r="14" fill="var(--color-accent-muted)" />
					{:else}
						<path d={describeArc(16, 16, 14, 0, prodAngle)} fill="var(--color-accent)" />
						<path d={describeArc(16, 16, 14, prodAngle, 360)} fill="var(--color-accent-muted)" />
					{/if}
				</svg>
				<span class="sr-only"
					>Production: {prodTestSplit.prodPct}%, Test: {prodTestSplit.testPct}%</span
				>
				<div style="font-family: var(--font-mono); font-size: 0.6875rem; line-height: 1.5;">
					<p class="text-[var(--color-text)]" style="margin: 0;">
						{prodTestSplit.prodPct}% prod
					</p>
					<p class="text-[var(--color-text-secondary)]" style="margin: 0;">
						{prodTestSplit.testPct}% test
					</p>
				</div>
			{:else}
				<p
					class="text-[var(--color-text)]"
					style="font-family: var(--font-mono); font-size: 1.125rem; font-weight: 500;"
				>
					--
				</p>
			{/if}
		</div>
	</div>

	<!-- Average growth -->
	<div class="strata-card px-4 py-3.5">
		<p
			class="text-[var(--color-text-tertiary)]"
			style="font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: 0.08em; text-transform: uppercase;"
		>
			Average growth
		</p>
		<div
			class="mt-1.5"
			style="font-family: var(--font-mono); font-size: 0.6875rem; line-height: 1.5;"
		>
			<p class="text-[var(--color-text)]" style="margin: 0;">
				Overall: {avgDailyGrowth >= 0 ? '+' : ''}{formatNumber(avgDailyGrowth)}/day
			</p>
			<div class="flex items-center gap-1" style="margin: 0;">
				<p class="text-[var(--color-text-secondary)]" style="margin: 0;">
					Last 90d: {avgGrowthLast90 >= 0 ? '+' : ''}{formatNumber(avgGrowthLast90)}/day
				</p>
				{#if growthTrend !== 'neutral'}
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
						style="flex-shrink: 0;"
					>
						<title
							>{growthTrend === 'up' ? 'Growth is accelerating' : 'Growth is decelerating'}</title
						>
						{#if growthTrend === 'up'}
							<path
								d="M8 3 L8 13 M4 7 L8 3 L12 7"
								stroke="var(--color-success)"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						{:else}
							<path
								d="M8 13 L8 3 M4 9 L8 13 L12 9"
								stroke="var(--color-error)"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						{/if}
					</svg>
				{/if}
			</div>
		</div>
	</div>

	<!-- Age -->
	<div class="strata-card px-4 py-3.5">
		<p
			class="text-[var(--color-text-tertiary)]"
			style="font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: 0.08em; text-transform: uppercase;"
		>
			Age
		</p>
		{#if days.length > 0}
			<p
				class="mt-1.5 text-[var(--color-text)]"
				style="font-family: var(--font-mono); font-size: 1.125rem; font-weight: 500; letter-spacing: -0.01em;"
			>
				{#if repoAge.years > 0}{repoAge.years}y
				{/if}{repoAge.months}mo
			</p>
			<p
				class="mt-0.5 text-[var(--color-text-secondary)]"
				style="font-family: var(--font-mono); font-size: 0.6875rem;"
			>
				started {repoAge.startLabel}
			</p>
			{#if repoAge.isDead}
				<div class="mt-1 flex items-center gap-1">
					<!-- Tombstone icon -->
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
						style="flex-shrink: 0;"
					>
						<title>Repository appears inactive</title>
						<path
							d="M4 14 L4 6 C4 3.2 5.8 2 8 2 C10.2 2 12 3.2 12 6 L12 14"
							stroke="var(--color-text-tertiary)"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<line
							x1="4"
							y1="14"
							x2="12"
							y2="14"
							stroke="var(--color-text-tertiary)"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
					<p
						class="text-[var(--color-text-tertiary)]"
						style="font-family: var(--font-mono); font-size: 0.625rem; margin: 0;"
					>
						Seems dead since {repoAge.deadSince}
					</p>
				</div>
			{/if}
		{:else}
			<p
				class="mt-1.5 text-[var(--color-text)]"
				style="font-family: var(--font-mono); font-size: 1.125rem; font-weight: 500;"
			>
				--
			</p>
		{/if}
	</div>

	<!-- Peak day -->
	<div class="strata-card px-4 py-3.5">
		<p
			class="text-[var(--color-text-tertiary)]"
			style="font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: 0.08em; text-transform: uppercase;"
		>
			Peak day
		</p>
		{#if peakDay.growth > 0}
			<div class="mt-1.5 flex items-center gap-1.5">
				<p
					class="text-[var(--color-text)]"
					style="font-family: var(--font-mono); font-size: 1.125rem; font-weight: 500; letter-spacing: -0.01em; margin: 0;"
				>
					+{formatNumber(peakDay.growth)}
				</p>
				<!-- Firework burst icon -->
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					aria-hidden="true"
					style="flex-shrink: 0;"
				>
					<line
						x1="8"
						y1="2"
						x2="8"
						y2="5"
						stroke="var(--color-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<line
						x1="8"
						y1="11"
						x2="8"
						y2="14"
						stroke="var(--color-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<line
						x1="2"
						y1="8"
						x2="5"
						y2="8"
						stroke="var(--color-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<line
						x1="11"
						y1="8"
						x2="14"
						y2="8"
						stroke="var(--color-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<line
						x1="3.8"
						y1="3.8"
						x2="5.5"
						y2="5.5"
						stroke="var(--color-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<line
						x1="10.5"
						y1="10.5"
						x2="12.2"
						y2="12.2"
						stroke="var(--color-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<line
						x1="12.2"
						y1="3.8"
						x2="10.5"
						y2="5.5"
						stroke="var(--color-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<line
						x1="5.5"
						y1="10.5"
						x2="3.8"
						y2="12.2"
						stroke="var(--color-accent)"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
			</div>
			<p
				class="mt-0.5 text-[var(--color-text-secondary)]"
				style="font-family: var(--font-mono); font-size: 0.6875rem;"
			>
				{peakDateFormatted}
			</p>
		{:else}
			<p
				class="mt-1.5 text-[var(--color-text)]"
				style="font-family: var(--font-mono); font-size: 1.125rem; font-weight: 500;"
			>
				--
			</p>
		{/if}
	</div>
</div>
