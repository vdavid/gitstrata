<script lang="ts">
	import { browser } from '$app/environment';
	import { getLanguages } from '$lib/languages';
	import type { DayStats } from '$lib/types';
	import type { Chart as ChartType, ChartConfiguration, ChartDataset } from 'chart.js';

	interface Props {
		days: DayStats[];
		/** Language ids sorted by final-day line count desc */
		detectedLanguages: string[];
		/** Whether data is still streaming in */
		live?: boolean;
	}

	let { days, detectedLanguages, live = false }: Props = $props();

	type ViewMode = 'all' | 'prod-vs-test' | 'languages-only';
	let viewMode = $state<ViewMode>('all');
	let patternFills = $state(false);

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let chart: ChartType | undefined = $state();
	let chartReady = $state(false);

	// Dynamic import to avoid SSR issues with hammerjs
	let ChartConstructor: typeof ChartType | undefined = $state();

	$effect(() => {
		if (browser && !ChartConstructor) {
			loadChart();
		}
	});

	const loadChart = async () => {
		const [chartModule, adapterModule, zoomModule] = await Promise.all([
			import('chart.js'),
			import('chartjs-adapter-date-fns'),
			import('chartjs-plugin-zoom')
		]);
		void adapterModule; // side-effect import

		const {
			Chart,
			LineController,
			LineElement,
			PointElement,
			Filler,
			LinearScale,
			TimeScale,
			Tooltip,
			Legend
		} = chartModule;

		Chart.register(
			LineController,
			LineElement,
			PointElement,
			Filler,
			LinearScale,
			TimeScale,
			Tooltip,
			Legend,
			zoomModule.default
		);

		ChartConstructor = Chart;
		chartReady = true;
	};

	const languageNameMap = $derived.by(() => {
		const entries: [string, string][] = getLanguages().map((lang) => [lang.id, lang.name]);
		return Object.fromEntries(entries) as Record<string, string>;
	});

	const langName = (id: string): string => languageNameMap[id] ?? id;

	/** Read a CSS custom property from :root */
	const getCssVar = (name: string): string => {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	};

	const getChartColor = (index: number): string => getCssVar(`--chart-${index + 1}`);
	const getChartTint = (index: number): string => getCssVar(`--chart-${index + 1}-tint`);

	/** Determine which languages get their own layer (>= 5% of total at latest point) */
	const computeVisibleLanguages = (
		daysList: DayStats[],
		allLangs: string[]
	): { shown: string[]; other: boolean } => {
		if (daysList.length === 0) return { shown: [], other: false };
		const last = daysList[daysList.length - 1];
		const totalAtEnd = last.total || 1;

		const shown: string[] = [];
		let hasOther = false;

		for (const langId of allLangs) {
			const lc = last.languages[langId];
			if (!lc || lc.total <= 0) continue;
			if (lc.total / totalAtEnd >= 0.05) {
				shown.push(langId);
			} else {
				hasOther = true;
			}
		}

		return { shown, other: hasOther };
	};

	/** Whether a language's test layer should be shown separately (>= 10% of that language) */
	const shouldSplitTestLayer = (daysList: DayStats[], langId: string): boolean => {
		if (daysList.length === 0) return false;
		const last = daysList[daysList.length - 1];
		const lc = last.languages[langId];
		if (!lc || lc.prod === undefined || lc.test === undefined) return false;
		return lc.total > 0 && lc.test / lc.total >= 0.1;
	};

	const maxChartColors = 12;

	type PatternStyle = 'diagonal' | 'dots' | 'crosshatch' | 'horizontal' | 'vertical' | 'zigzag';
	const patternStyles: PatternStyle[] = [
		'diagonal',
		'dots',
		'crosshatch',
		'horizontal',
		'vertical',
		'zigzag'
	];

	/** Create a canvas pattern with a given style and color */
	const createPattern = (color: string, style: PatternStyle): CanvasPattern | string => {
		const size = 10;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) return color;

		// Fill background with semi-transparent color
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, size, size);

		// Draw pattern overlay in a darker version
		ctx.strokeStyle = getCssVar('--color-text');
		ctx.globalAlpha = 0.3;
		ctx.lineWidth = 1.5;

		switch (style) {
			case 'diagonal':
				ctx.beginPath();
				ctx.moveTo(0, size);
				ctx.lineTo(size, 0);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(-size / 2, size / 2);
				ctx.lineTo(size / 2, -size / 2);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(size / 2, size + size / 2);
				ctx.lineTo(size + size / 2, size / 2);
				ctx.stroke();
				break;
			case 'dots':
				ctx.beginPath();
				ctx.arc(size / 2, size / 2, 2, 0, Math.PI * 2);
				ctx.fillStyle = getCssVar('--color-text');
				ctx.globalAlpha = 0.3;
				ctx.fill();
				break;
			case 'crosshatch':
				ctx.beginPath();
				ctx.moveTo(0, size);
				ctx.lineTo(size, 0);
				ctx.moveTo(0, 0);
				ctx.lineTo(size, size);
				ctx.stroke();
				break;
			case 'horizontal':
				ctx.beginPath();
				ctx.moveTo(0, size / 2);
				ctx.lineTo(size, size / 2);
				ctx.stroke();
				break;
			case 'vertical':
				ctx.beginPath();
				ctx.moveTo(size / 2, 0);
				ctx.lineTo(size / 2, size);
				ctx.stroke();
				break;
			case 'zigzag':
				ctx.beginPath();
				ctx.moveTo(0, size * 0.75);
				ctx.lineTo(size / 2, size * 0.25);
				ctx.lineTo(size, size * 0.75);
				ctx.stroke();
				break;
		}

		const pattern = canvasEl?.getContext('2d')?.createPattern(canvas, 'repeat');
		return pattern ?? color;
	};

	/** Get background for a dataset: pattern if enabled, solid color otherwise */
	const getBackground = (color: string, index: number): string | CanvasPattern => {
		if (!patternFills) return color;
		const style = patternStyles[index % patternStyles.length];
		return createPattern(color, style);
	};

	const buildDatasets = (
		daysList: DayStats[],
		shown: string[],
		hasOther: boolean,
		mode: ViewMode
	): ChartDataset<'line'>[] => {
		const datasets: ChartDataset<'line'>[] = [];
		let dsIndex = 0;

		if (mode === 'prod-vs-test') {
			const prodData = daysList.map((d) => {
				let prod = 0;
				for (const lc of Object.values(d.languages)) {
					prod += lc.prod ?? lc.total;
				}
				return prod;
			});
			const testData = daysList.map((d) => {
				let test = 0;
				for (const lc of Object.values(d.languages)) {
					test += lc.test ?? 0;
				}
				return test;
			});

			datasets.push({
				label: 'Production',
				data: prodData,
				backgroundColor: getBackground(getChartColor(0) + '80', dsIndex++),
				borderColor: getChartColor(0),
				borderWidth: 1.5,
				fill: true,
				tension: 0.3,
				pointRadius: 0,
				pointHitRadius: 6
			});
			datasets.push({
				label: 'Test',
				data: testData,
				backgroundColor: getBackground(getChartTint(0) + '80', dsIndex++),
				borderColor: getChartTint(0),
				borderWidth: 1.5,
				fill: true,
				tension: 0.3,
				pointRadius: 0,
				pointHitRadius: 6
			});
			return datasets;
		}

		shown.forEach((langId, i) => {
			const colorIdx = i % maxChartColors;
			const splitTest = mode === 'all' && shouldSplitTestLayer(daysList, langId);

			if (splitTest) {
				const prodData = daysList.map((d) => {
					const lc = d.languages[langId];
					return lc?.prod ?? lc?.total ?? 0;
				});
				datasets.push({
					label: `${langName(langId)} (prod)`,
					data: prodData,
					backgroundColor: getBackground(getChartColor(colorIdx) + '80', dsIndex++),
					borderColor: getChartColor(colorIdx),
					borderWidth: 1.5,
					fill: true,
					tension: 0.3,
					pointRadius: 0,
					pointHitRadius: 6
				});
				const testData = daysList.map((d) => {
					const lc = d.languages[langId];
					return lc?.test ?? 0;
				});
				datasets.push({
					label: `${langName(langId)} (test)`,
					data: testData,
					backgroundColor: getBackground(getChartTint(colorIdx) + '80', dsIndex++),
					borderColor: getChartTint(colorIdx),
					borderWidth: 1.5,
					fill: true,
					tension: 0.3,
					pointRadius: 0,
					pointHitRadius: 6
				});
			} else {
				const totalData = daysList.map((d) => {
					const lc = d.languages[langId];
					return lc?.total ?? 0;
				});
				datasets.push({
					label: langName(langId),
					data: totalData,
					backgroundColor: getBackground(getChartColor(colorIdx) + '80', dsIndex++),
					borderColor: getChartColor(colorIdx),
					borderWidth: 1.5,
					fill: true,
					tension: 0.3,
					pointRadius: 0,
					pointHitRadius: 6
				});
			}
		});

		if (hasOther) {
			const shownSet = new Set(shown);
			const otherData = daysList.map((d) => {
				let sum = 0;
				for (const [id, lc] of Object.entries(d.languages)) {
					if (!shownSet.has(id)) sum += lc.total;
				}
				return sum;
			});
			datasets.push({
				label: 'Other',
				data: otherData,
				backgroundColor: getBackground(getCssVar('--chart-other') + '80', dsIndex++),
				borderColor: getCssVar('--chart-other'),
				borderWidth: 1.5,
				fill: true,
				tension: 0.3,
				pointRadius: 0,
				pointHitRadius: 6
			});
		}

		return datasets;
	};

	const buildConfig = (
		daysList: DayStats[],
		datasets: ChartDataset<'line'>[]
	): ChartConfiguration<'line'> => {
		const labels = daysList.map((d) => d.date);
		const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

		return {
			type: 'line',
			data: { labels, datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: reducedMotion ? false : { duration: 400 },
				interaction: {
					mode: 'index',
					intersect: false
				},
				scales: {
					x: {
						type: 'time',
						time: { unit: 'month', tooltipFormat: 'yyyy-MM-dd' },
						grid: { color: getCssVar('--color-border') + '30' },
						ticks: {
							color: getCssVar('--color-text-tertiary'),
							maxTicksLimit: 12,
							font: { family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''), size: 10 }
						},
						border: { color: getCssVar('--color-border') }
					},
					y: {
						stacked: true,
						beginAtZero: true,
						grid: { color: getCssVar('--color-border') + '30' },
						ticks: {
							color: getCssVar('--color-text-tertiary'),
							font: { family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''), size: 10 },
							callback: (value) => {
								const v = value as number;
								if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
								if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
								return String(v);
							}
						},
						border: { color: getCssVar('--color-border') }
					}
				},
				plugins: {
					tooltip: {
						backgroundColor: getCssVar('--color-surface-raised'),
						titleColor: getCssVar('--color-text'),
						bodyColor: getCssVar('--color-text-secondary'),
						borderColor: getCssVar('--color-border'),
						borderWidth: 1,
						padding: 12,
						titleFont: {
							family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''),
							size: 11
						},
						bodyFont: {
							family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''),
							size: 11
						},
						footerColor: getCssVar('--color-text'),
						footerFont: {
							family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''),
							size: 11,
							weight: 'bold' as const
						},
						cornerRadius: 6,
						callbacks: {
							label: (ctx) => {
								const val = ctx.parsed.y ?? 0;
								const formatted =
									val >= 1_000_000
										? `${(val / 1_000_000).toFixed(1)}M`
										: val >= 1_000
											? `${(val / 1_000).toFixed(1)}K`
											: String(val);
								return `${ctx.dataset.label}: ${formatted} lines`;
							},
							footer: (items) => {
								const total = items.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0);
								const formatted =
									total >= 1_000_000
										? `${(total / 1_000_000).toFixed(1)}M`
										: total >= 1_000
											? `${(total / 1_000).toFixed(1)}K`
											: String(total);
								return `Total: ${formatted} lines`;
							}
						}
					},
					legend: {
						position: 'bottom',
						labels: {
							color: getCssVar('--color-text-secondary'),
							padding: 16,
							usePointStyle: true,
							pointStyle: 'rectRounded',
							font: {
								family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''),
								size: 11
							}
						}
					},
					zoom: {
						pan: { enabled: true, mode: 'x' },
						zoom: {
							wheel: { enabled: true },
							pinch: { enabled: true },
							mode: 'x'
						}
					}
				}
			}
		};
	};

	const resetZoom = () => {
		chart?.resetZoom();
	};

	const ariaLabel = $derived.by(() => {
		if (days.length === 0) return 'Empty chart';
		const last = days[days.length - 1];
		const first = days[0];
		const totalLines =
			last.total >= 1_000_000
				? `${(last.total / 1_000_000).toFixed(1)} million`
				: last.total >= 1_000
					? `${(last.total / 1_000).toFixed(0)} thousand`
					: String(last.total);
		const langCount = detectedLanguages.length;
		return `Stacked area chart showing ${totalLines} lines of code across ${langCount} languages from ${first.date} to ${last.date}`;
	});

	// Render/update chart when days or viewMode change
	$effect(() => {
		if (!canvasEl || !chartReady || !ChartConstructor) return;

		const { shown, other: hasOther } = computeVisibleLanguages(days, detectedLanguages);
		const datasets = buildDatasets(days, shown, hasOther, viewMode);
		const config = buildConfig(days, datasets);

		if (chart) {
			chart.data = config.data;
			if (config.options) {
				chart.options = config.options;
			}
			chart.update(live ? 'none' : undefined);
		} else {
			chart = new ChartConstructor(canvasEl, config);
		}
	});

	// Clean up on component destroy
	$effect(() => {
		return () => {
			chart?.destroy();
			chart = undefined;
		};
	});
</script>

<div class="strata-card overflow-hidden">
	<!-- View toggles + reset zoom -->
	<div
		class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3"
		role="group"
		aria-label="Chart view mode"
	>
		{#each [{ mode: 'all' as ViewMode, label: 'All' }, { mode: 'prod-vs-test' as ViewMode, label: 'Prod vs test' }, { mode: 'languages-only' as ViewMode, label: 'Languages only' }] as toggle (toggle.mode)}
			<button
				onclick={() => (viewMode = toggle.mode)}
				aria-pressed={viewMode === toggle.mode}
				class="strata-chip"
			>
				{toggle.label}
			</button>
		{/each}
		<div class="flex-1"></div>
		<button
			onclick={() => (patternFills = !patternFills)}
			aria-pressed={patternFills}
			class="strata-chip text-xs"
			title="Toggle pattern fills for color blindness accessibility"
		>
			Pattern fills
		</button>
		<button onclick={resetZoom} class="btn-ghost text-xs"> Reset zoom </button>
	</div>

	<!-- Chart canvas -->
	<div class="relative h-64 w-full p-4 sm:h-80 md:h-96 lg:h-[28rem] xl:h-[32rem]">
		<canvas bind:this={canvasEl} aria-label={ariaLabel}></canvas>
	</div>

	{#if live}
		<div class="border-t border-[var(--color-border)] px-4 py-2">
			<p
				class="text-center text-[var(--color-text-tertiary)]"
				style="font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.02em;"
			>
				Chart updates as data streams in...
			</p>
		</div>
	{/if}
</div>
