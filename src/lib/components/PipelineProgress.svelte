<script lang="ts">
	interface Props {
		phase: 'cloning' | 'processing';
		clonePhase: string;
		cloneLoaded: number;
		cloneTotal: number;
		cloneElapsedMs: number;
		processCurrent: number;
		processTotal: number;
		processDate: string;
		processElapsedMs: number;
		oncancel: () => void;
	}

	let {
		phase,
		clonePhase,
		cloneLoaded,
		cloneTotal,
		cloneElapsedMs,
		processCurrent,
		processTotal,
		processDate,
		processElapsedMs,
		oncancel
	}: Props = $props();

	type StepState = 'done' | 'active' | 'pending';

	const downloadPhases = ['Compressing objects', 'Receiving objects', 'Resolving deltas'];

	const activeStep = $derived.by((): 'connect' | 'download' | 'analyze' => {
		if (phase === 'processing') return 'analyze';
		if (downloadPhases.some((p) => clonePhase.startsWith(p))) return 'download';
		return 'connect';
	});

	const connectState = $derived.by((): StepState => {
		if (activeStep === 'connect') return 'active';
		return 'done';
	});

	const downloadState = $derived.by((): StepState => {
		if (activeStep === 'download') return 'active';
		if (activeStep === 'analyze') return 'done';
		return 'pending';
	});

	const analyzeState = $derived.by((): StepState => {
		if (activeStep === 'analyze') return 'active';
		return 'pending';
	});

	const isDeterminate = $derived.by(() => {
		if (phase === 'processing') return processTotal > 0;
		return cloneTotal > 0;
	});

	const progressPercent = $derived.by(() => {
		if (phase === 'processing') {
			return processTotal > 0 ? Math.min((processCurrent / processTotal) * 100, 100) : 0;
		}
		return cloneTotal > 0 ? Math.min((cloneLoaded / cloneTotal) * 100, 100) : 0;
	});

	const barColor = $derived(
		phase === 'processing' ? 'var(--color-success)' : 'var(--color-accent)'
	);

	const estimatedRemainingMs = $derived.by(() => {
		if (phase !== 'processing' || processCurrent <= 0 || processTotal <= 0) return 0;
		const msPerDay = processElapsedMs / processCurrent;
		return Math.round(msPerDay * (processTotal - processCurrent));
	});

	const formatBytes = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	const formatTime = (ms: number): string => {
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remainSecs = secs % 60;
		return `${mins}m ${remainSecs}s`;
	};

	const detailLeft = $derived.by(() => {
		if (phase === 'processing') {
			const dayLabel = processTotal === 1 ? 'day' : 'days';
			const dateStr = processDate ? ` \u00b7 ${processDate}` : '';
			return `${processCurrent} / ${processTotal} ${dayLabel}${dateStr}`;
		}

		if (clonePhase.startsWith('Detecting default branch')) return 'Detecting branch\u2026';
		if (clonePhase.startsWith('Counting objects')) return `${cloneLoaded} objects`;
		if (clonePhase.startsWith('Compressing objects'))
			return `${cloneLoaded} / ${cloneTotal} objects`;
		if (clonePhase.startsWith('Receiving objects')) {
			return cloneTotal > 0
				? `${formatBytes(cloneLoaded)} / ~${formatBytes(cloneTotal)}`
				: formatBytes(cloneLoaded);
		}
		if (clonePhase.startsWith('Resolving deltas')) return `${cloneLoaded} / ${cloneTotal} deltas`;
		if (clonePhase.startsWith('Fetching new commits')) return 'Fetching new commits\u2026';

		return clonePhase || 'Connecting\u2026';
	});

	const detailRight = $derived.by(() => {
		if (phase === 'processing') {
			if (estimatedRemainingMs > 0 && processCurrent > 2)
				return `~${formatTime(estimatedRemainingMs)} remaining`;
			return formatTime(processElapsedMs);
		}
		return formatTime(cloneElapsedMs);
	});

	const progressLabel = $derived(
		phase === 'processing' ? 'Analysis progress' : 'Download progress'
	);
</script>

<div class="strata-card p-5" role="region" aria-label="Pipeline progress">
	<!-- Step indicator + cancel -->
	<div class="mb-4 flex items-center justify-between">
		<ol class="pipeline-steps" role="list" aria-label="Pipeline steps">
			<li
				class="pipeline-step"
				class:pipeline-step--done={connectState === 'done'}
				class:pipeline-step--active={connectState === 'active'}
				class:pipeline-step--pending={connectState === 'pending'}
				aria-current={connectState === 'active' ? 'step' : undefined}
			>
				<span class="pipeline-dot" aria-hidden="true">
					{#if connectState === 'done'}
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
							<path
								d="M2 5.5L4 7.5L8 3"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</span>
				<span class="pipeline-label">Connect</span>
			</li>
			<li class="pipeline-connector" aria-hidden="true">
				<span class="pipeline-line" class:pipeline-line--done={connectState === 'done'}></span>
			</li>
			<li
				class="pipeline-step"
				class:pipeline-step--done={downloadState === 'done'}
				class:pipeline-step--active={downloadState === 'active'}
				class:pipeline-step--pending={downloadState === 'pending'}
				aria-current={downloadState === 'active' ? 'step' : undefined}
			>
				<span class="pipeline-dot" aria-hidden="true">
					{#if downloadState === 'done'}
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
							<path
								d="M2 5.5L4 7.5L8 3"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</span>
				<span class="pipeline-label">Download</span>
			</li>
			<li class="pipeline-connector" aria-hidden="true">
				<span class="pipeline-line" class:pipeline-line--done={downloadState === 'done'}></span>
			</li>
			<li
				class="pipeline-step"
				class:pipeline-step--done={analyzeState === 'done'}
				class:pipeline-step--active={analyzeState === 'active'}
				class:pipeline-step--pending={analyzeState === 'pending'}
				aria-current={analyzeState === 'active' ? 'step' : undefined}
			>
				<span class="pipeline-dot" aria-hidden="true">
					{#if analyzeState === 'done'}
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
							<path
								d="M2 5.5L4 7.5L8 3"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</span>
				<span class="pipeline-label">Analyze</span>
			</li>
		</ol>
		<button onclick={oncancel} class="btn-ghost text-xs"> Cancel </button>
	</div>

	<!-- Progress bar -->
	<div
		class="strata-progress-track"
		role="progressbar"
		aria-valuenow={isDeterminate ? Math.round(progressPercent) : undefined}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-label={progressLabel}
	>
		<div
			class="strata-progress-fill"
			style="background-color: {barColor}; width: {isDeterminate
				? progressPercent
				: 30}%{isDeterminate ? '' : '; animation: strata-pulse 2s ease-in-out infinite'}"
		></div>
	</div>

	<!-- Detail line -->
	<div
		class="mt-2.5 flex items-center justify-between text-[var(--color-text-tertiary)]"
		style="font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.02em;"
		aria-live="polite"
		aria-atomic="true"
	>
		<span>{detailLeft}</span>
		<span>{detailRight}</span>
	</div>
</div>
