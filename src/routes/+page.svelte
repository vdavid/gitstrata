<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { parseRepoUrl } from '$lib/url';
	import { getResult, saveResult } from '$lib/cache';
	import { createAnalyzer, type AnalyzerHandle } from '$lib/worker/analyzer.api';
	import type { AnalysisResult, DayStats, ErrorKind, ProgressEvent } from '$lib/types';
	import RepoInput from '$lib/components/RepoInput.svelte';
	import CloneProgress from '$lib/components/CloneProgress.svelte';
	import ProcessProgress from '$lib/components/ProcessProgress.svelte';
	import ResultsChart from '$lib/components/ResultsChart.svelte';
	import ResultsSummary from '$lib/components/ResultsSummary.svelte';
	import ResultsTable from '$lib/components/ResultsTable.svelte';

	const corsProxy = 'https://cors.isomorphic-git.org';

	type Phase = 'idle' | 'cloning' | 'processing' | 'done' | 'error';

	let phase = $state<Phase>('idle');
	let errorMessage = $state('');
	let errorKind = $state<ErrorKind>('unknown');

	// Clone progress
	let clonePhase = $state('');
	let cloneLoaded = $state(0);
	let cloneTotal = $state(0);
	let cloneStartTime = $state(0);
	let cloneElapsed = $state(0);

	// Process progress
	let processCurrent = $state(0);
	let processTotal = $state(0);
	let processDate = $state('');
	let processStartTime = $state(0);
	let processElapsed = $state(0);

	// Results (progressive and final)
	let streamingDays = $state<DayStats[]>([]);
	let streamingLanguages = $state<string[]>([]);
	let result = $state<AnalysisResult | undefined>();
	let cachedResult = $state<AnalysisResult | undefined>();

	// Timer interval
	let timerInterval = $state<ReturnType<typeof setInterval> | undefined>();

	// Worker handle
	let analyzer = $state<AnalyzerHandle | undefined>();

	// Share link feedback
	let shareCopied = $state(false);

	// Focus management: reference to progress area
	let progressAreaEl: HTMLDivElement | undefined = $state();

	// Last repo input for retry
	let lastRepoInput = $state('');

	// Read ?repo= from URL on initial load
	const initialRepo = $derived.by(() => {
		if (!browser) return '';
		return $page.url.searchParams.get('repo') ?? '';
	});

	let hasAutoStarted = $state(false);

	$effect(() => {
		if (browser && initialRepo && !hasAutoStarted) {
			hasAutoStarted = true;
			startAnalysis(initialRepo);
		}
	});

	const startTimer = (kind: 'clone' | 'process') => {
		stopTimer();
		const startTime = Date.now();
		if (kind === 'clone') {
			cloneStartTime = startTime;
		} else {
			processStartTime = startTime;
		}
		timerInterval = setInterval(() => {
			if (kind === 'clone') {
				cloneElapsed = Date.now() - cloneStartTime;
			} else {
				processElapsed = Date.now() - processStartTime;
			}
		}, 250);
	};

	const stopTimer = () => {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = undefined;
		}
	};

	const resetState = () => {
		phase = 'idle';
		errorMessage = '';
		errorKind = 'unknown';
		clonePhase = '';
		cloneLoaded = 0;
		cloneTotal = 0;
		cloneElapsed = 0;
		processCurrent = 0;
		processTotal = 0;
		processDate = '';
		processElapsed = 0;
		streamingDays = [];
		streamingLanguages = [];
		result = undefined;
		cachedResult = undefined;
		stopTimer();
	};

	const updateQueryParam = (repo: string) => {
		const url = new URL(window.location.href);
		if (repo) {
			url.searchParams.set('repo', repo);
		} else {
			url.searchParams.delete('repo');
		}
		goto(url.toString(), { replaceState: true, keepFocus: true });
	};

	const handleProgress = (event: ProgressEvent) => {
		switch (event.type) {
			case 'clone':
				phase = 'cloning';
				clonePhase = event.phase;
				cloneLoaded = event.loaded;
				cloneTotal = event.total;
				break;
			case 'process':
				if (phase !== 'processing') {
					phase = 'processing';
					stopTimer();
					startTimer('process');
				}
				processCurrent = event.current;
				processTotal = event.total;
				processDate = event.date;
				break;
			case 'day-result':
				streamingDays = [...streamingDays, event.day];
				updateStreamingLanguages(event.day);
				break;
			case 'done':
				stopTimer();
				result = event.result;
				phase = 'done';
				saveResult(event.result);
				break;
			case 'error':
				stopTimer();
				phase = 'error';
				errorMessage = event.message;
				errorKind = event.kind;
				break;
			case 'size-warning':
				break;
		}
	};

	const updateStreamingLanguages = (day: DayStats) => {
		const seen = new Set(streamingLanguages);
		for (const langId of Object.keys(day.languages)) {
			if (!seen.has(langId)) {
				seen.add(langId);
			}
		}
		// Sort by line count in latest day (desc)
		const langTotals = new Map<string, number>();
		for (const d of streamingDays) {
			for (const [id, lc] of Object.entries(d.languages)) {
				langTotals.set(id, lc.total);
			}
		}
		streamingLanguages = [...seen].sort(
			(a, b) => (langTotals.get(b) ?? 0) - (langTotals.get(a) ?? 0)
		);
	};

	const startAnalysis = async (repoInput: string) => {
		// Cancel any running analysis
		cancel();
		resetState();
		lastRepoInput = repoInput;

		try {
			const parsed = parseRepoUrl(repoInput);
			updateQueryParam(repoInput);

			// Check cache first
			const cached = await getResult(parsed.url);
			if (cached) {
				cachedResult = cached;
				result = cached;
				phase = 'done';
				return;
			}

			phase = 'cloning';
			startTimer('clone');

			analyzer = createAnalyzer();

			// Move focus to progress area for screen readers
			requestAnimationFrame(() => {
				progressAreaEl?.focus();
			});

			await analyzer.analyze(repoInput, corsProxy, handleProgress);
		} catch (e) {
			stopTimer();
			if (phase !== 'error') {
				phase = 'error';
				errorMessage = e instanceof Error ? e.message : 'Analysis failed';
				errorKind = 'unknown';
			}
		}
	};

	const cancel = () => {
		stopTimer();
		if (analyzer) {
			analyzer.cancel();
			analyzer.terminate();
			analyzer = undefined;
		}
		phase = 'idle';
	};

	const retry = () => {
		if (lastRepoInput) {
			startAnalysis(lastRepoInput);
		}
	};

	const refresh = async () => {
		if (!result) return;
		const previousResult = result;
		const repoUrl = result.repoUrl;

		// Keep showing cached results while refreshing
		streamingDays = [...previousResult.days];
		streamingLanguages = [...previousResult.detectedLanguages];
		cachedResult = previousResult;
		result = undefined;

		phase = 'cloning';
		startTimer('clone');

		try {
			analyzer = createAnalyzer();
			await analyzer.analyzeIncremental(
				repoUrl,
				corsProxy,
				previousResult,
				handleProgress
			);
		} catch (e) {
			stopTimer();
			if (phase !== 'error') {
				phase = 'error';
				errorMessage = e instanceof Error ? e.message : 'Refresh failed';
				errorKind = 'unknown';
			}
		}
	};

	const copyShareLink = async () => {
		await navigator.clipboard.writeText(window.location.href);
		shareCopied = true;
		setTimeout(() => (shareCopied = false), 2000);
	};

	/** Whether the error kind supports a retry button */
	const retryable = $derived(
		errorKind === 'cors-proxy-down' || errorKind === 'network-lost' || errorKind === 'unknown'
	);

	const displayDays = $derived(result?.days ?? streamingDays);
	const displayLanguages = $derived(result?.detectedLanguages ?? streamingLanguages);
	const isStreaming = $derived(phase === 'processing' && !result);
</script>

<svelte:head>
	<title>git strata — see your codebase's heartbeat</title>
</svelte:head>

<div class="space-y-6 sm:space-y-8">
	<!-- Hero section -->
	<div class="text-center">
		<h1
			class="text-3xl font-bold tracking-tight text-[var(--color-text)] sm:text-4xl lg:text-5xl"
		>
			See your codebase's heartbeat
		</h1>
		<p class="mx-auto mt-3 max-w-xl text-base text-[var(--color-text-secondary)] sm:text-lg">
			Visualize how any public Git repository grows over time, broken down by language.
			Everything runs in your browser.
		</p>
	</div>

	<!-- Input -->
	<div class="mx-auto max-w-2xl">
		<RepoInput
			onsubmit={startAnalysis}
			disabled={phase === 'cloning' || phase === 'processing'}
			initialValue={initialRepo}
		/>
	</div>

	<!-- Error -->
	{#if phase === 'error'}
		<div
			class="mx-auto max-w-2xl rounded-xl border border-[var(--color-error)]
				bg-[var(--color-error-light)] p-4"
			role="alert"
		>
			<p class="text-sm text-[var(--color-error)]">{errorMessage}</p>
			<div class="mt-2 flex items-center gap-3">
				{#if retryable}
					<button
						onclick={retry}
						class="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium
							text-white transition-colors hover:bg-[var(--color-accent-hover)]"
					>
						Retry
					</button>
				{/if}
				<button
					onclick={() => (phase = 'idle')}
					class="text-sm text-[var(--color-accent)] hover:underline"
				>
					{retryable ? 'Cancel' : 'Try another repo'}
				</button>
			</div>
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- Progress area (focus target for screen readers) -->
	<div
		bind:this={progressAreaEl}
		tabindex={-1}
		class="outline-none"
		role="status"
		aria-live="polite"
		aria-atomic="false"
	>
		<!-- Clone progress -->
		{#if phase === 'cloning'}
			<div class="mx-auto max-w-2xl">
				<CloneProgress
					phase={clonePhase}
					loaded={cloneLoaded}
					total={cloneTotal}
					elapsedMs={cloneElapsed}
					oncancel={cancel}
				/>
			</div>
		{/if}

		<!-- Process progress -->
		{#if phase === 'processing'}
			<div class="mx-auto max-w-2xl">
				<ProcessProgress
					current={processCurrent}
					total={processTotal}
					date={processDate}
					elapsedMs={processElapsed}
					oncancel={cancel}
				/>
			</div>
		{/if}
	</div>

	<!-- Results -->
	{#if displayDays.length > 0}
		<div class="space-y-6">
			<!-- Cached badge + refresh + share -->
			{#if result}
				<div class="flex flex-wrap items-center justify-center gap-3">
					{#if cachedResult}
						<span
							class="inline-flex items-center gap-1.5 rounded-full
								bg-[var(--color-bg-secondary)] border border-[var(--color-border)]
								px-3 py-1 text-xs text-[var(--color-text-secondary)]"
						>
							Last analyzed: {cachedResult.analyzedAt.slice(0, 10)}
						</span>
						<button
							onclick={refresh}
							class="rounded-md px-3 py-1 text-sm text-[var(--color-accent)]
								transition-colors hover:underline"
						>
							Refresh
						</button>
					{/if}
					<button
						onclick={copyShareLink}
						class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm
							text-[var(--color-text-secondary)] transition-colors
							hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]"
					>
						{shareCopied ? 'Copied!' : 'Copy link'}
					</button>
				</div>
			{/if}

			<!-- Summary stats -->
			<ResultsSummary days={displayDays} detectedLanguages={displayLanguages} />

			<!-- Chart -->
			<ResultsChart
				days={displayDays}
				detectedLanguages={displayLanguages}
				live={isStreaming}
			/>

			<!-- Data table (only when fully done) -->
			{#if result}
				<details class="group">
					<summary
						class="cursor-pointer rounded-lg px-1 py-2 text-sm font-medium
							text-[var(--color-text-secondary)] transition-colors
							hover:text-[var(--color-text)]"
					>
						View data table
					</summary>
					<div class="mt-3">
						<ResultsTable days={result.days} detectedLanguages={result.detectedLanguages} />
					</div>
				</details>
			{/if}
		</div>
	{/if}
</div>
