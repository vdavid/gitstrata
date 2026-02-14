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
	class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5"
	role="region"
	aria-label="Clone progress"
>
	<div class="mb-3 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<div class="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]"></div>
			<span class="text-sm font-medium text-[var(--color-text)]">
				Downloading...
			</span>
		</div>
		<button
			onclick={oncancel}
			class="rounded-md px-3 py-1 text-sm text-[var(--color-text-secondary)]
				transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]"
		>
			Cancel
		</button>
	</div>

	<!-- Progress bar -->
	<div
		class="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]"
		role="progressbar"
		aria-valuenow={Math.round(progress)}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-label="Download progress"
	>
		<div
			class="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300 ease-out"
			style="width: {hasEstimate ? progress : 30}%{hasEstimate ? '' : '; animation: pulse 2s ease-in-out infinite'}"
		></div>
	</div>

	<!-- Details row -->
	<div
		class="mt-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]"
		aria-live="polite"
		aria-atomic="true"
	>
		<span>
			{formatBytes(loaded)}{#if hasEstimate}
				{' '}/ ~{formatBytes(total)}
			{/if}
			{#if phase}
				<span class="text-[var(--color-text-tertiary)]">&middot; {phase}</span>
			{/if}
		</span>
		<span>{formatTime(elapsedMs)}</span>
	</div>
</div>
