<script lang="ts">
	import { formatBytes } from '$lib/cache';

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

	// --- Phase definitions ---

	type PhaseId = 'detect' | 'count' | 'compress' | 'receive' | 'resolve' | 'analyze';
	type PhaseState = 'done' | 'active' | 'pending';

	interface PhaseDefinition {
		id: PhaseId;
		label: string;
		incrementalLabel?: string;
		determinate: boolean;
	}

	const phases: PhaseDefinition[] = [
		{ id: 'detect', label: 'Detect branch', incrementalLabel: 'Fetch commits', determinate: false },
		{ id: 'count', label: 'Count objects', determinate: false },
		{ id: 'compress', label: 'Compress objects', determinate: true },
		{ id: 'receive', label: 'Receive objects', determinate: true },
		{ id: 'resolve', label: 'Resolve deltas', determinate: true },
		{ id: 'analyze', label: 'Analyze commits', determinate: true }
	];

	// --- Phase info descriptions (rich HTML, with live data) ---

	const getPhaseInfo = (phaseId: PhaseId): string => {
		switch (phaseId) {
			case 'detect':
				return `<p>Every git repo has a default branch, but the name isn\u2019t standardized \u2014 it could be \u201cmain,\u201d \u201cmaster,\u201d or something custom. The app uses git\u2019s protocol v2 to ask the server for the branch list without downloading any repo data.</p>
<p>GitHub switched from \u201cmaster\u201d to \u201cmain\u201d as the default in 2020, so older repos often still use the old name. This step figures out which one to clone.</p>`;

			case 'count': {
				const snap = snapshots['count'];
				const statBlock =
					snap && snap.loaded > 0
						? `<span class="phase-info-stat"><span class="phase-info-stat-value">${formatNumber(snap.loaded)}</span> objects discovered</span>`
						: '';
				return `<p>Git stores everything \u2014 commits, files, directory listings \u2014 as objects, each identified by a unique SHA hash. The server is counting how many objects it needs to pack and send over.</p>
<p>This is server-side work, so there\u2019s no progress bar on this end \u2014 the app is waiting for the server to finish its tally. Larger repos with more history naturally have more objects.</p>
${statBlock}`;
			}

			case 'compress': {
				const snap = snapshots['compress'];
				const statBlock =
					snap && snap.total > 0
						? `<span class="phase-info-stat"><span class="phase-info-stat-value">${formatNumber(snap.loaded)} / ${formatNumber(snap.total)}</span> objects packed</span>`
						: snap && snap.loaded > 0
							? `<span class="phase-info-stat"><span class="phase-info-stat-value">${formatNumber(snap.loaded)}</span> objects packed</span>`
							: '';
				return `<p>The server packs objects using <strong>delta compression</strong> \u2014 it finds similarities between objects and stores only the differences. This is what makes git so space-efficient.</p>
<p>A repo with years of history might compress down to a fraction of its raw size. The server is building this optimized pack right now.</p>
${statBlock}`;
			}

			case 'receive': {
				const snap = snapshots['receive'];
				const ts = phaseTimestamps['receive'];
				let statBlock = '';
				if (snap && snap.loaded > 0) {
					const elapsedSec = ts ? ((ts.endTime ?? liveElapsedNow) - ts.startTime) / 1000 : 0;
					const speed =
						elapsedSec > 0.5
							? ` at <span class="phase-info-stat-value">~${formatBytes(Math.round(snap.loaded / elapsedSec))}/s</span>`
							: '';
					statBlock = `<span class="phase-info-stat"><span class="phase-info-stat-value">${formatBytes(snap.loaded)}</span> received${speed}</span>`;
				}
				return `<p>This is the actual download \u2014 bytes flowing from the server through a CORS proxy into the browser. Everything runs in a Web Worker so the page stays responsive while data streams in.</p>
<p>The pack file contains all the compressed objects from the previous step. Once it arrives, the objects still need to be unpacked and reconstructed.</p>
${statBlock}`;
			}

			case 'resolve': {
				const snap = snapshots['resolve'];
				const statBlock =
					snap && snap.total > 0
						? `<span class="phase-info-stat"><span class="phase-info-stat-value">${formatNumber(snap.loaded)} / ${formatNumber(snap.total)}</span> deltas resolved</span>`
						: snap && snap.loaded > 0
							? `<span class="phase-info-stat"><span class="phase-info-stat-value">${formatNumber(snap.loaded)}</span> deltas resolved</span>`
							: '';
				return `<p>The compressed delta objects need to be reconstructed back into full objects \u2014 like decompressing a zip file, but more clever. Git\u2019s delta encoding works with object similarities, not file boundaries.</p>
<p>Each delta references a base object and describes how to transform it. The resolver chains these deltas together to rebuild every object in full.</p>
${statBlock}`;
			}

			case 'analyze': {
				const snap = snapshots['analyze'];
				let statBlock = '';
				if (snap && snap.total > 0) {
					const dateStr = processDate
						? `<span class="phase-info-stat-value">${processDate}</span> \u2014 `
						: '';
					statBlock = `<span class="phase-info-stat">${dateStr}day <span class="phase-info-stat-value">${formatNumber(snap.loaded)}</span> of <span class="phase-info-stat-value">${formatNumber(snap.total)}</span></span>`;
				}
				return `<p>Walking through the repo\u2019s history day by day, counting lines per language, and classifying each file as production or test code. Every day gets its own snapshot of the codebase.</p>
<p>Older repos with long histories take longer here \u2014 there\u2019s a lot of ground to cover. The results are cached locally, so repeat visits skip this step entirely.</p>
${statBlock}`;
			}
		}
	};

	// --- Map clonePhase string to phase id ---

	const clonePhaseToIdMap: Record<string, PhaseId> = {
		'Detecting default branch': 'detect',
		Counting: 'count',
		Compressing: 'compress',
		Receiving: 'receive',
		Resolving: 'resolve',
		'Fetching new commits': 'detect'
	};

	const mapClonePhaseToId = (cp: string): PhaseId | null => {
		for (const [prefix, id] of Object.entries(clonePhaseToIdMap)) {
			if (cp.startsWith(prefix)) return id;
		}
		return null;
	};

	// --- Per-phase data snapshots ---

	interface PhaseSnapshot {
		loaded: number;
		total: number;
	}

	let snapshots: Record<string, PhaseSnapshot> = $state({});
	let previousPhaseId: PhaseId | null = $state(null);
	let seenFetching = $state(false);

	const cloneSubPhaseComplete = $derived(
		phase === 'cloning' && cloneTotal > 0 && cloneLoaded >= cloneTotal
	);

	const activePhaseId = $derived.by((): PhaseId | null => {
		if (phase === 'processing') return 'analyze';
		const mapped = mapClonePhaseToId(clonePhase);
		if (mapped && cloneSubPhaseComplete) return null; // Between sub-phases: no active phase
		return mapped;
	});

	const activeIndex = $derived(
		activePhaseId ? phases.findIndex((p) => p.id === activePhaseId) : -1
	);

	// Track highest phase index we've ever reached (for "done" detection when between sub-phases)
	let highestReachedIndex = $state(-1);

	$effect(() => {
		if (activeIndex > highestReachedIndex) {
			highestReachedIndex = activeIndex;
		}
	});

	// Keep snapshots up to date: live data for the active phase, frozen for completed phases
	$effect(() => {
		if (activePhaseId && activePhaseId !== previousPhaseId) {
			previousPhaseId = activePhaseId;
		}
		if (activePhaseId && phase === 'cloning') {
			snapshots[activePhaseId] = { loaded: cloneLoaded, total: cloneTotal };
		}
	});

	// Also snapshot when sub-phase completes (loaded >= total)
	$effect(() => {
		if (cloneSubPhaseComplete && previousPhaseId) {
			snapshots[previousPhaseId] = { loaded: cloneLoaded, total: cloneTotal };
		}
	});

	// Track analyze phase data
	$effect(() => {
		if (phase === 'processing') {
			snapshots['analyze'] = { loaded: processCurrent, total: processTotal };
		}
	});

	// Track incremental mode
	$effect(() => {
		if (clonePhase.startsWith('Fetching new commits')) {
			seenFetching = true;
		}
	});

	// --- Phase state derivation ---

	const getPhaseState = (index: number): PhaseState => {
		if (activeIndex >= 0) {
			if (index < activeIndex) return 'done';
			if (index === activeIndex) return 'active';
			return 'pending';
		}
		// No active phase (between sub-phases)
		if (index <= highestReachedIndex) return 'done';
		return 'pending';
	};

	// --- Per-phase elapsed time tracking ---

	interface PhaseTimestamp {
		startTime: number;
		endTime: number | null;
	}

	let phaseTimestamps: Record<string, PhaseTimestamp> = $state({});
	let liveElapsedNow = $state(Date.now());

	// Record start time when a phase becomes active, and end time when it completes
	$effect(() => {
		if (activePhaseId) {
			// Set start time if not already set
			if (!phaseTimestamps[activePhaseId]) {
				phaseTimestamps[activePhaseId] = { startTime: Date.now(), endTime: null };
			}
		}
	});

	// When activeIndex advances, freeze timestamps for all prior phases
	$effect(() => {
		const now = Date.now();
		for (let idx = 0; idx < phases.length; idx++) {
			const pid = phases[idx].id;
			const state = getPhaseState(idx);
			const ts = phaseTimestamps[pid];
			if (state === 'done' && ts && ts.endTime === null) {
				phaseTimestamps[pid] = { ...ts, endTime: now };
			}
		}
	});

	// Live-updating tick for the active phase timer
	$effect(() => {
		if (activePhaseId) {
			const interval = setInterval(() => {
				liveElapsedNow = Date.now();
			}, 250);
			return () => clearInterval(interval);
		}
	});

	const getPhaseElapsedMs = (phaseId: PhaseId, state: PhaseState): number | null => {
		const ts = phaseTimestamps[phaseId];
		if (!ts) return null;
		if (state === 'active') {
			// Force reactivity on liveElapsedNow
			return liveElapsedNow - ts.startTime;
		}
		if (state === 'done' && ts.endTime !== null) {
			return ts.endTime - ts.startTime;
		}
		return null;
	};

	// --- Info popup state ---

	let openInfoPhaseId: PhaseId | null = $state(null);

	const toggleInfo = (phaseId: PhaseId) => {
		openInfoPhaseId = openInfoPhaseId === phaseId ? null : phaseId;
	};

	const closeInfo = () => {
		openInfoPhaseId = null;
	};

	// Close popup on Escape key
	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && openInfoPhaseId) {
			closeInfo();
		}
	};

	// Close popup when clicking outside
	const handleOutsideClick = (event: MouseEvent) => {
		if (!openInfoPhaseId) return;
		const target = event.target as HTMLElement;
		if (!target.closest('.phase-info-anchor')) {
			closeInfo();
		}
	};

	// --- Per-phase detail text ---

	const formatNumber = (n: number): string => n.toLocaleString();

	const getPhaseDetail = (phaseDef: PhaseDefinition, state: PhaseState): string => {
		const snap = snapshots[phaseDef.id];
		if (!snap) return '';

		switch (phaseDef.id) {
			case 'detect':
				return '';

			case 'count':
				if (snap.loaded > 0) return `${formatNumber(snap.loaded)} objects`;
				return '';

			case 'compress':
				if (state === 'active' && !cloneSubPhaseComplete && snap.total > 0)
					return `${formatNumber(snap.loaded)} / ${formatNumber(snap.total)} objects`;
				if (state === 'done' && snap.total > 0) return `${formatNumber(snap.total)} objects`;
				if (state === 'done' && snap.loaded > 0) return `${formatNumber(snap.loaded)} objects`;
				return '';

			case 'receive':
				if (state === 'active' && !cloneSubPhaseComplete) {
					return snap.total > 0
						? `${formatBytes(snap.loaded)} / ~${formatBytes(snap.total)}`
						: formatBytes(snap.loaded);
				}
				if (state === 'done') {
					const bytes = snap.total > 0 ? snap.total : snap.loaded;
					return bytes > 0 ? formatBytes(bytes) : '';
				}
				return '';

			case 'resolve':
				if (state === 'active' && !cloneSubPhaseComplete && snap.total > 0)
					return `${formatNumber(snap.loaded)} / ${formatNumber(snap.total)} deltas`;
				if (state === 'done' && snap.total > 0) return `${formatNumber(snap.total)} deltas`;
				if (state === 'done' && snap.loaded > 0) return `${formatNumber(snap.loaded)} deltas`;
				return '';

			case 'analyze': {
				if (state !== 'active') return '';
				const dayLabel = processTotal === 1 ? 'day' : 'days';
				const dateStr = processDate ? ` \u00b7 ${processDate}` : '';
				return `${formatNumber(processCurrent)} / ${formatNumber(processTotal)} ${dayLabel}${dateStr}`;
			}

			default:
				return '';
		}
	};

	// --- Progress bar logic ---

	const getPhaseProgress = (
		phaseDef: PhaseDefinition,
		state: PhaseState
	): { show: boolean; percent: number; color: string } => {
		if (state !== 'active') return { show: false, percent: 0, color: '' };
		if (!phaseDef.determinate) return { show: false, percent: 0, color: '' };

		const snap = snapshots[phaseDef.id];
		if (!snap || snap.total <= 0) return { show: false, percent: 0, color: '' };
		if (cloneSubPhaseComplete && phaseDef.id !== 'analyze')
			return { show: false, percent: 0, color: '' };

		const percent = Math.min((snap.loaded / snap.total) * 100, 100);
		const color = phaseDef.id === 'analyze' ? 'var(--color-success)' : 'var(--color-accent)';
		return { show: true, percent, color };
	};

	// --- Time and ETA ---

	const formatTime = (ms: number): string => {
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remainSecs = secs % 60;
		return `${mins}m ${remainSecs}s`;
	};

	const totalElapsed = $derived(
		phase === 'processing' ? cloneElapsedMs + processElapsedMs : cloneElapsedMs
	);

	const estimatedRemainingMs = $derived.by(() => {
		if (phase !== 'processing' || processCurrent <= 0 || processTotal <= 0) return 0;
		const msPerDay = processElapsedMs / processCurrent;
		return Math.round(msPerDay * (processTotal - processCurrent));
	});

	const getPhaseLabel = (phaseDef: PhaseDefinition): string => {
		if (phaseDef.incrementalLabel && seenFetching) return phaseDef.incrementalLabel;
		return phaseDef.label;
	};
</script>

<div
	class="strata-card p-5"
	role="region"
	aria-label="Pipeline progress"
	onkeydown={handleKeydown}
	onclick={handleOutsideClick}
>
	<ol class="phase-log" role="list" aria-label="Clone phases">
		{#each phases as phaseDef, i (phaseDef.id)}
			{@const state = getPhaseState(i)}
			{@const detail = getPhaseDetail(phaseDef, state)}
			{@const progress = getPhaseProgress(phaseDef, state)}
			{@const isLast = i === phases.length - 1}
			{@const phaseElapsed = getPhaseElapsedMs(phaseDef.id, state)}
			<li class="phase-row" aria-current={state === 'active' ? 'step' : undefined}>
				<!-- Indicator column: dot + connector -->
				<div class="phase-indicator">
					<span
						class="phase-dot"
						class:phase-dot--done={state === 'done'}
						class:phase-dot--active={state === 'active'}
						class:phase-dot--pending={state === 'pending'}
						aria-hidden="true"
					>
						{#if state === 'done'}
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
					{#if !isLast}
						<span
							class="phase-connector"
							class:phase-connector--done={state === 'done'}
							aria-hidden="true"
						></span>
					{/if}
				</div>

				<!-- Content column: label, detail, progress bar -->
				<div class="phase-content" class:phase-content--last={isLast}>
					<div class="phase-header">
						<span class="phase-label-group">
							<span
								class="phase-label"
								class:phase-label--done={state === 'done'}
								class:phase-label--active={state === 'active'}
								class:phase-label--pending={state === 'pending'}
							>
								{getPhaseLabel(phaseDef)}
							</span>
							{#if phaseElapsed !== null}
								<span
									class="phase-elapsed"
									class:phase-elapsed--active={state === 'active'}
									class:phase-elapsed--done={state === 'done'}
								>
									{formatTime(phaseElapsed)}
								</span>
							{/if}
							{#if state === 'done' || state === 'active'}
								<span class="phase-info-anchor" class:phase-info-fade-in={state === 'active'}>
									<button
										class="phase-info-btn"
										aria-label="About {getPhaseLabel(phaseDef).toLowerCase()}"
										onclick={(e) => {
											e.stopPropagation();
											toggleInfo(phaseDef.id);
										}}
									>
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
										>
											<circle cx="12" cy="12" r="10" />
											<line x1="12" y1="16" x2="12" y2="12" />
											<line x1="12" y1="8" x2="12.01" y2="8" />
										</svg>
									</button>
									{#if openInfoPhaseId === phaseDef.id}
										<div
											class="phase-info-popup"
											role="dialog"
											aria-label="{getPhaseLabel(phaseDef)} info"
										>
											<!-- eslint-disable-next-line svelte/no-at-html-tags -- Content is self-generated, not user input -->
											{@html getPhaseInfo(phaseDef.id)}
										</div>
									{/if}
								</span>
							{/if}
						</span>
						{#if detail}
							<span class="phase-detail">{detail}</span>
						{/if}
					</div>

					{#if progress.show}
						<div
							class="strata-progress-track mt-1.5"
							role="progressbar"
							aria-valuenow={Math.round(progress.percent)}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-label="{getPhaseLabel(phaseDef)} progress"
						>
							<div
								class="strata-progress-fill"
								style="background-color: {progress.color}; width: {progress.percent}%"
							></div>
						</div>
					{/if}

					{#if phaseDef.id === 'analyze' && state === 'active' && estimatedRemainingMs > 0 && processCurrent > 2}
						<span class="phase-eta" aria-live="polite">
							~{formatTime(estimatedRemainingMs)} remaining
						</span>
					{/if}
				</div>
			</li>
		{/each}
	</ol>

	<!-- Footer: elapsed time + cancel -->
	<div class="mt-4 flex items-center justify-between" aria-live="polite" aria-atomic="true">
		<span class="phase-footer-time">
			<span class="phase-footer-label">Total time:</span>
			<span class="phase-footer-value">{formatTime(totalElapsed)}</span>
		</span>
		<button onclick={oncancel} class="btn-ghost text-xs">Cancel</button>
	</div>
</div>
