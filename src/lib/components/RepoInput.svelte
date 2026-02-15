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
		if (error) {
			const trimmed = inputValue.trim();
			if (trimmed) {
				const validationError = validate(trimmed);
				error = validationError ?? '';
			} else {
				error = '';
			}
		}
	};
</script>

<div class="w-full">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
		<div class="relative flex-1">
			<input
				type="url"
				bind:value={inputValue}
				onkeydown={handleKeydown}
				oninput={handleInput}
				placeholder="Example: https://github.com/sveltejs/svelte"
				{disabled}
				class="w-full border bg-[var(--color-surface-raised)] px-4 py-2.5
					text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)]
					{error
					? 'border-[var(--color-error)]'
					: 'border-[var(--color-border)] focus:border-[var(--color-accent)]'}
					disabled:cursor-not-allowed disabled:opacity-50"
				style="
					font-family: var(--font-mono);
					letter-spacing: 0.01em;
					border-radius: 6px;
					transition: border-color var(--duration-fast) var(--ease-out-expo);
					outline: none;
				"
				aria-label="Repository URL"
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? 'repo-input-error' : undefined}
			/>
			{#if error}
				<p
					id="repo-input-error"
					class="mt-1.5 text-xs text-[var(--color-error)]"
					style="font-family: var(--font-sans);"
					role="alert"
				>
					{error}
				</p>
			{/if}
		</div>
		<button onclick={handleSubmit} {disabled} class="btn-primary shrink-0"> Analyze </button>
	</div>

	<div
		class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-tertiary)]"
		style="font-family: var(--font-mono); letter-spacing: 0.02em;"
	>
		<span>try:</span>
		{#each quickExamples as example, i (example.value)}
			{#if i > 0}
				<span class="text-[var(--color-border-strong)]">/</span>
			{/if}
			<button
				onclick={() => handleExample(example.value)}
				{disabled}
				class="text-[var(--color-text-secondary)] transition-colors
					hover:text-[var(--color-accent)]
					disabled:cursor-not-allowed disabled:opacity-50"
				style="transition-duration: var(--duration-fast);"
			>
				{example.label}
			</button>
		{/each}
	</div>
</div>
