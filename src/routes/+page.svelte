<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
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

	const corsProxy = env.PUBLIC_CORS_PROXY_URL || 'https://cors.isomorphic-git.org';

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

	// Size warning
	let sizeWarningBytes = $state(0);
	let showSizeWarning = $state(false);

	// Chart data table toggle
	let showDataTable = $state(false);

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
		sizeWarningBytes = 0;
		showSizeWarning = false;
		stopTimer();
	};

	const updateQueryParam = (repo: string) => {
		const qs = repo ? `?repo=${encodeURIComponent(repo)}` : '';
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve('/') is used, qs is appended
		goto(resolve('/') + qs, { replaceState: true, keepFocus: true });
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
				sizeWarningBytes = event.estimatedBytes;
				showSizeWarning = true;
				break;
		}
	};

	const updateStreamingLanguages = (day: DayStats) => {
		const seen: Record<string, true> = {};
		for (const langId of streamingLanguages) {
			seen[langId] = true;
		}
		for (const langId of Object.keys(day.languages)) {
			seen[langId] = true;
		}
		// Sort by line count in latest day (desc)
		const langTotals: Record<string, number> = {};
		for (const d of streamingDays) {
			for (const [id, lc] of Object.entries(d.languages)) {
				langTotals[id] = lc.total;
			}
		}
		streamingLanguages = Object.keys(seen).sort(
			(a, b) => (langTotals[b] ?? 0) - (langTotals[a] ?? 0)
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
			await analyzer.analyzeIncremental(repoUrl, corsProxy, previousResult, handleProgress);
		} catch (e) {
			stopTimer();
			// phase may have been set to 'error' by handleProgress during the await
			if ((phase as Phase) !== 'error') {
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

	const formatBytes = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	};

	const dismissSizeWarning = () => {
		showSizeWarning = false;
	};
</script>

<svelte:head>
	<title>git strata -- see your codebase's heartbeat</title>
</svelte:head>

<div class="space-y-8 sm:space-y-10">
	<!-- Hero section -->
	<div class="relative py-4 text-center sm:py-6">
		<div class="strata-hero-lines"></div>
		<div class="relative">
			<h1
				class="text-3xl font-bold tracking-tight text-[var(--color-text)] sm:text-4xl lg:text-5xl"
				style="font-family: var(--font-sans); letter-spacing: -0.025em;"
			>
				See your codebase's
				<span class="text-[var(--color-accent)]">heartbeat</span>
			</h1>
			<p
				class="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-[var(--color-text-secondary)] sm:text-base"
				style="font-family: var(--font-sans);"
			>
				Visualize how any public Git repository grows over time, broken down by language. Everything
				runs in your browser.
			</p>
		</div>
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
			class="strata-card strata-fade-in mx-auto max-w-2xl border-[var(--color-error)] p-5"
			role="alert"
		>
			<div class="flex items-start gap-3">
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--color-error)"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="mt-0.5 shrink-0"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="15" y1="9" x2="9" y2="15" />
					<line x1="9" y1="9" x2="15" y2="15" />
				</svg>
				<div class="min-w-0 flex-1">
					<p class="text-sm text-[var(--color-error)]">{errorMessage}</p>
					<div class="mt-3 flex items-center gap-3">
						{#if retryable}
							<button onclick={retry} class="btn-primary text-sm">
								{errorKind === 'network-lost' ? 'Retry (resumes)' : 'Retry'}
							</button>
						{/if}
						{#if errorKind === 'indexeddb-full'}
							<button
								onclick={() => {
									const el = document.getElementById('cache-manager');
									if (el) {
										el.scrollIntoView({ behavior: 'smooth' });
									}
								}}
								class="btn-primary text-sm"
							>
								Manage cache
							</button>
						{/if}
						<button onclick={() => (phase = 'idle')} class="btn-link text-sm">
							{retryable ? 'Cancel' : 'Try another repo'}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- Focus management: this live region receives programmatic focus (via requestAnimationFrame)
	     when analysis starts, so screen readers announce updates. tabindex={-1} allows programmatic
	     focus without adding to tab order. WCAG 4.1.3 compliant. -->
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
			<div class="mx-auto max-w-2xl strata-fade-in">
				<CloneProgress
					phase={clonePhase}
					loaded={cloneLoaded}
					total={cloneTotal}
					elapsedMs={cloneElapsed}
					oncancel={cancel}
				/>
			</div>
		{/if}

		<!-- Size warning -->
		{#if showSizeWarning && phase === 'cloning'}
			<div
				class="strata-card strata-fade-in mx-auto max-w-2xl border-[var(--color-warning)] p-5 mt-4"
				role="alert"
			>
				<div class="flex items-start gap-3">
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--color-warning)"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="mt-0.5 shrink-0"
						aria-hidden="true"
					>
						<path
							d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
						/>
						<line x1="12" y1="9" x2="12" y2="13" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</svg>
					<div class="min-w-0 flex-1">
						<p class="text-sm text-[var(--color-text)]">
							This repository is large (~{formatBytes(sizeWarningBytes)}). Downloading may take a
							while and use significant storage.
						</p>
						<div class="mt-3 flex items-center gap-3">
							<button onclick={dismissSizeWarning} class="btn-primary text-sm"> Continue </button>
							<button onclick={cancel} class="btn-link text-sm"> Cancel </button>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Process progress -->
		{#if phase === 'processing'}
			<div class="mx-auto max-w-2xl strata-fade-in">
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
		<div class="space-y-8">
			<!-- Cached badge + refresh + share -->
			{#if result}
				<div class="flex flex-wrap items-center justify-center gap-3 strata-fade-in">
					{#if cachedResult}
						<span class="strata-badge">
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<circle cx="12" cy="12" r="10" />
								<polyline points="12 6 12 12 16 14" />
							</svg>
							Last analyzed: {cachedResult.analyzedAt.slice(0, 10)}
						</span>
						<button
							onclick={refresh}
							aria-label="Refresh analysis with latest commits"
							class="btn-link"
						>
							Refresh
						</button>
					{/if}
					<button
						onclick={copyShareLink}
						aria-label={shareCopied
							? 'Repository link copied to clipboard'
							: 'Copy repository link to clipboard'}
						class="btn-ghost"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
							<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
						</svg>
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
				ondatatoggle={(show) => (showDataTable = show)}
			/>

			<!-- Data table (when toggled or when fully done) -->
			{#if showDataTable || result}
				<div>
					<h2
						class="py-2 text-sm text-[var(--color-text-secondary)]"
						style="font-family: var(--font-mono); font-size: 0.8125rem; letter-spacing: 0.02em;"
					>
						Data table
					</h2>
					<div class="mt-4">
						<ResultsTable days={displayDays} detectedLanguages={displayLanguages} />
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
