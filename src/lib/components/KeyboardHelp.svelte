<script lang="ts">
	import { browser } from '$app/environment';

	let open = $state(false);
	let dialogEl: HTMLDialogElement | undefined = $state();

	const shortcuts = [
		{ key: 'Tab', description: 'Navigate between elements' },
		{ key: 'Enter / Space', description: 'Activate buttons and controls' },
		{ key: 'Arrow keys', description: 'Navigate within control groups' },
		{ key: '?', description: 'Show this help dialog' }
	];

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
			e.preventDefault();
			open = !open;
		}
	};

	$effect(() => {
		if (!browser) return;
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	});

	$effect(() => {
		if (open) {
			dialogEl?.showModal();
		} else {
			dialogEl?.close();
		}
	});

	const close = () => {
		open = false;
	};
</script>

<button
	onclick={() => (open = true)}
	class="text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
	style="font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.02em;"
	aria-label="Show keyboard shortcuts"
>
	Shortcuts (?)
</button>

<dialog
	bind:this={dialogEl}
	onclose={close}
	class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)]
		p-6 text-[var(--color-text)] shadow-lg backdrop:bg-black/50"
	style="max-width: 380px; width: 90vw;"
	aria-label="Keyboard shortcuts"
>
	<div class="flex items-center justify-between mb-4">
		<h2
			class="text-sm font-semibold text-[var(--color-text)]"
			style="font-family: var(--font-sans);"
		>
			Keyboard shortcuts
		</h2>
		<button
			onclick={close}
			class="flex h-8 w-8 items-center justify-center rounded-md
				text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text)]"
			aria-label="Close keyboard shortcuts"
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<line x1="18" y1="6" x2="6" y2="18" />
				<line x1="6" y1="6" x2="18" y2="18" />
			</svg>
		</button>
	</div>
	<ul class="space-y-2">
		{#each shortcuts as shortcut (shortcut.key)}
			<li class="flex items-center justify-between gap-4">
				<span
					class="text-xs text-[var(--color-text-secondary)]"
					style="font-family: var(--font-sans);"
				>
					{shortcut.description}
				</span>
				<kbd
					class="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)]
						px-2 py-0.5 text-xs text-[var(--color-text-secondary)]"
					style="font-family: var(--font-mono);"
				>
					{shortcut.key}
				</kbd>
			</li>
		{/each}
	</ul>
</dialog>
