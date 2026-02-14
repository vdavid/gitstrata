<script lang="ts">
	import '../app.css';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import CacheManager from '$lib/components/CacheManager.svelte';

	let { children } = $props();
</script>

<div class="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
	<a
		href="#main-content"
		class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50
			focus:rounded-md focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-white"
	>
		Skip to main content
	</a>
	<header
		class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-4 sm:px-6"
	>
		<a href="/" class="flex items-center gap-2 text-lg font-semibold tracking-tight text-[var(--color-text)]">
			<svg
				width="22"
				height="22"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				class="text-[var(--color-accent)]"
			>
				<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
			</svg>
			git strata
		</a>
		<ThemeToggle />
	</header>

	<main id="main-content" class="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8 2xl:max-w-7xl">
		{@render children()}
	</main>

	<footer
		class="border-t border-[var(--color-border)] px-4 py-6 text-center text-sm
			text-[var(--color-text-secondary)] sm:px-6"
	>
		<CacheManager />
		<p class="mt-4">
			All processing happens in your browser. No code leaves your machine.
		</p>
	</footer>
</div>
