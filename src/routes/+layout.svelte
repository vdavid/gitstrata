<script>
	import '../app.css';

	let { children } = $props();
</script>

<div class="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
	<header class="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
		<span class="text-lg font-semibold">git strata</span>
		<!-- Theme toggle will go here -->
	</header>

	<main class="mx-auto max-w-5xl px-6 py-8">
		{@render children()}
	</main>

	<footer class="px-6 py-4 text-center text-sm text-[var(--color-text-secondary)]">
		<!-- Cache manager will go here -->
	</footer>
</div>
