<script lang="ts">
	import { parseRepoUrl } from '$lib/url';

	interface Props {
		onsubmit: (repoUrl: string) => void;
		disabled?: boolean;
		initialValue?: string;
	}

	let { onsubmit, disabled = false, initialValue = '' }: Props = $props();

	let inputValue = $state('');
	let error = $state('');

	$effect(() => {
		if (initialValue) {
			inputValue = initialValue;
		}
	});

	const quickExamples = [
		{ label: 'sveltejs/svelte', value: 'sveltejs/svelte' },
		{ label: 'denoland/deno', value: 'denoland/deno' },
		{ label: 'expressjs/express', value: 'expressjs/express' }
	];

	const validate = (value: string): string | undefined => {
		try {
			parseRepoUrl(value);
			return undefined;
		} catch (e) {
			return e instanceof Error ? e.message : 'Invalid repository URL';
		}
	};

	const handleSubmit = () => {
		const trimmed = inputValue.trim();
		if (!trimmed) {
			error = 'Enter a repository URL to get started';
			return;
		}

		const validationError = validate(trimmed);
		if (validationError) {
			error = validationError;
			return;
		}

		error = '';
		onsubmit(trimmed);
	};

	const handleExample = (value: string) => {
		inputValue = value;
		error = '';
		onsubmit(value);
	};

	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleSubmit();
		}
	};

	const handleInput = () => {
		if (error) error = '';
	};
</script>

<div class="w-full">
	<div
		class="flex flex-col gap-3 sm:flex-row sm:items-start"
	>
		<div class="relative flex-1">
			<input
				type="url"
				bind:value={inputValue}
				onkeydown={handleKeydown}
				oninput={handleInput}
				placeholder="Example: https://github.com/sveltejs/svelte"
				{disabled}
				class="w-full rounded-lg border bg-[var(--color-bg)] px-4 py-3
					text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)]
					transition-colors
					{error
					? 'border-[var(--color-error)]'
					: 'border-[var(--color-border)] focus:border-[var(--color-accent)]'}
					disabled:cursor-not-allowed disabled:opacity-50"
				aria-label="Repository URL"
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? 'repo-input-error' : undefined}
			/>
			{#if error}
				<p
					id="repo-input-error"
					class="mt-1.5 text-sm text-[var(--color-error)]"
					role="alert"
				>
					{error}
				</p>
			{/if}
		</div>
		<button
			onclick={handleSubmit}
			{disabled}
			class="shrink-0 rounded-lg bg-[var(--color-accent)] px-6 py-3
				font-medium text-white transition-colors
				hover:bg-[var(--color-accent-hover)]
				disabled:cursor-not-allowed disabled:opacity-50"
		>
			Analyze
		</button>
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-x-1 text-sm text-[var(--color-text-secondary)]">
		<span>Try:</span>
		{#each quickExamples as example, i}
			{#if i > 0}
				<span class="text-[var(--color-text-tertiary)]">&middot;</span>
			{/if}
			<button
				onclick={() => handleExample(example.value)}
				disabled={disabled}
				class="text-[var(--color-accent)] transition-colors
					hover:text-[var(--color-accent-hover)] hover:underline
					disabled:cursor-not-allowed disabled:opacity-50"
			>
				{example.label}
			</button>
		{/each}
	</div>
</div>
