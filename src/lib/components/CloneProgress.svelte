<script lang="ts">
	interface Props {
		phase: string;
		loaded: number;
		total: number;
		elapsedMs: number;
		oncancel: () => void;
	}

	let { phase, loaded, total, elapsedMs, oncancel }: Props = $props();

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

	const progress = $derived(total > 0 ? Math.min((loaded / total) * 100, 100) : 0);
	const hasEstimate = $derived(total > 0);
</script>

<div
	class="strata-card p-5"
	role="region"
	aria-label="Clone progress"
>
	<div class="mb-4 flex items-center justify-between">
		<div class="flex items-center gap-2.5">
			<div class="strata-pulse-dot bg-[var(--color-accent)]"></div>
			<span
				class="text-sm text-[var(--color-text)]"
				style="font-family: var(--font-sans); font-weight: 500;"
			>
				Downloading repository
			</span>
		</div>
		<button onclick={oncancel} class="btn-ghost text-xs">
			Cancel
		</button>
	</div>

	<!-- Progress bar -->
	<div
		class="strata-progress-track"
		role="progressbar"
		aria-valuenow={Math.round(progress)}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-label="Download progress"
	>
		<div
			class="strata-progress-fill bg-[var(--color-accent)]"
			style="width: {hasEstimate ? progress : 30}%{hasEstimate ? '' : '; animation: strata-pulse 2s ease-in-out infinite'}"
		></div>
	</div>

	<!-- Details row -->
	<div
		class="mt-2.5 flex items-center justify-between text-[var(--color-text-tertiary)]"
		style="font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.02em;"
		aria-live="polite"
		aria-atomic="true"
	>
		<span>
			{formatBytes(loaded)}{#if hasEstimate}
				{' '}/ ~{formatBytes(total)}
			{/if}
			{#if phase}
				<span class="text-[var(--color-text-tertiary)]"> -- {phase}</span>
			{/if}
		</span>
		<span>{formatTime(elapsedMs)}</span>
	</div>
</div>
