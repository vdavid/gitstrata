<script lang="ts">
	interface Props {
		current: number;
		total: number;
		date: string;
		elapsedMs: number;
		oncancel: () => void;
	}

	let { current, total, date, elapsedMs, oncancel }: Props = $props();

	const progress = $derived(total > 0 ? Math.min((current / total) * 100, 100) : 0);

	const estimatedRemainingMs = $derived.by(() => {
		if (current <= 0 || total <= 0) return 0;
		const msPerCommit = elapsedMs / current;
		return Math.round(msPerCommit * (total - current));
	});

	const formatTime = (ms: number): string => {
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remainSecs = secs % 60;
		return `${mins}m ${remainSecs}s`;
	};
</script>

<div class="strata-card p-5" role="region" aria-label="Processing progress">
	<div class="mb-4 flex items-center justify-between">
		<div class="flex items-center gap-2.5">
			<div class="strata-pulse-dot bg-[var(--color-success)]"></div>
			<span
				class="text-sm text-[var(--color-text)]"
				style="font-family: var(--font-sans); font-weight: 500;"
			>
				Processing commits
			</span>
		</div>
		<button onclick={oncancel} class="btn-ghost text-xs"> Cancel </button>
	</div>

	<!-- Progress bar -->
	<div
		class="strata-progress-track"
		role="progressbar"
		aria-valuenow={Math.round(progress)}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-label="Commit processing progress"
	>
		<div class="strata-progress-fill bg-[var(--color-success)]" style="width: {progress}%"></div>
	</div>

	<!-- Details row -->
	<div
		class="mt-2.5 flex items-center justify-between text-[var(--color-text-tertiary)]"
		style="font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.02em;"
		aria-live="polite"
		aria-atomic="true"
	>
		<span>
			{current} / {total} commits
			{#if date}
				<span class="text-[var(--color-text-tertiary)]"> -- {date}</span>
			{/if}
		</span>
		<span>
			{#if estimatedRemainingMs > 0 && current > 2}
				~{formatTime(estimatedRemainingMs)} remaining
			{:else}
				{formatTime(elapsedMs)}
			{/if}
		</span>
	</div>
</div>
