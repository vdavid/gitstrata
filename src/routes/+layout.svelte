<script lang="ts">
	import '../app.css';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import CacheManager from '$lib/components/CacheManager.svelte';
	import KeyboardHelp from '$lib/components/KeyboardHelp.svelte';

	let { children } = $props();

	const analyticsId = env.PUBLIC_ANALYTICS_ID;
</script>

<svelte:head>
	{#if analyticsId}
		<script defer data-domain={analyticsId} src="https://plausible.io/js/script.js"></script>
	{/if}
</svelte:head>

<div class="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
	<a
		href="#main-content"
		class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50
			focus:rounded-md focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-white"
	>
		Skip to main content
	</a>

	<header class="relative px-4 py-4 sm:px-6">
		<div class="mx-auto flex max-w-5xl items-center justify-between 2xl:max-w-7xl">
			<a href={resolve('/')} class="group flex items-center gap-2.5 text-[var(--color-text)]">
				<!-- Strata icon: layered horizontal lines -->
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					aria-hidden="true"
					class="transition-transform duration-300 group-hover:scale-105"
				>
					<rect x="2" y="4" width="20" height="3" rx="1" fill="var(--color-accent)" opacity="0.9" />
					<rect
						x="2"
						y="9"
						width="20"
						height="3"
						rx="1"
						fill="var(--color-accent-muted)"
						opacity="0.6"
					/>
					<rect
						x="2"
						y="14"
						width="20"
						height="3"
						rx="1"
						fill="var(--color-text-tertiary)"
						opacity="0.4"
					/>
					<rect
						x="2"
						y="19"
						width="20"
						height="3"
						rx="1"
						fill="var(--color-text-tertiary)"
						opacity="0.2"
					/>
				</svg>
				<span
					class="font-[var(--font-mono)] text-sm font-medium tracking-wide"
					style="font-family: var(--font-mono);"
				>
					git strata
				</span>
			</a>
			<ThemeToggle />
		</div>
		<div class="strata-line mx-auto mt-4 max-w-5xl 2xl:max-w-7xl"></div>
	</header>

	<main
		id="main-content"
		class="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10 2xl:max-w-7xl"
	>
		{@render children()}
	</main>

	<footer class="px-4 py-8 sm:px-6">
		<div class="mx-auto max-w-5xl 2xl:max-w-7xl">
			<div class="strata-line mb-6"></div>
			<div class="flex flex-col items-center gap-4">
				<CacheManager id="cache-manager" />
				<div class="flex items-center gap-4">
					<p
						class="text-center text-xs tracking-wide text-[var(--color-text-tertiary)]"
						style="font-family: var(--font-mono);"
					>
						All processing happens in your browser. No code leaves your machine.
					</p>
				</div>
				<KeyboardHelp />
			</div>
		</div>
	</footer>
</div>
