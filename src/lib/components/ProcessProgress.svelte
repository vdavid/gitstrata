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

<div
	class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5"
	role="region"
	aria-label="Processing progress"
>
	<div class="mb-3 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<div class="h-2 w-2 animate-pulse rounded-full bg-[var(--color-success)]"></div>
			<span class="text-sm font-medium text-[var(--color-text)]">
				Processing commits...
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
		aria-label="Commit processing progress"
	>
		<div
			class="h-full rounded-full bg-[var(--color-success)] transition-all duration-300 ease-out"
			style="width: {progress}%"
		></div>
	</div>

	<!-- Details row -->
	<div
		class="mt-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]"
		aria-live="polite"
		aria-atomic="true"
	>
		<span>
			{current} / {total} days
			{#if date}
				<span class="text-[var(--color-text-tertiary)]">&middot; {date}</span>
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
