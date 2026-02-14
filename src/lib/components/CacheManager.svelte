<script lang="ts">
	import { browser } from '$app/environment';
	import { listCachedRepos, deleteCachedResult, clearCache } from '$lib/cache';

	interface CachedRepo {
		repoUrl: string;
		analyzedAt: string;
		lastAccessed: string;
	}

	let repos = $state<CachedRepo[]>([]);
	let expanded = $state(false);

	const load = async () => {
		if (!browser) return;
		repos = await listCachedRepos();
	};

	$effect(() => {
		load();
	});

	const handleDelete = async (repoUrl: string) => {
		await deleteCachedResult(repoUrl);
		await load();
	};

	const handleClearAll = async () => {
		await clearCache();
		await load();
	};

	const formatDate = (iso: string): string => {
		try {
			return new Date(iso).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		} catch {
			return iso;
		}
	};

	/** Extract owner/repo from a normalized URL */
	const shortName = (url: string): string => {
		try {
			const parsed = new URL(url);
			return parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
		} catch {
			return url;
		}
	};
</script>

{#if repos.length > 0}
	<div class="mx-auto max-w-2xl">
		<button
			onclick={() => (expanded = !expanded)}
			class="text-sm text-[var(--color-text-secondary)] transition-colors
				hover:text-[var(--color-text)]"
		>
			{expanded ? 'Hide' : 'Manage'} cached repos ({repos.length})
		</button>

		{#if expanded}
			<div
				class="mt-3 rounded-xl border border-[var(--color-border)]
					bg-[var(--color-bg-secondary)] p-4 text-left"
			>
				<div class="mb-3 flex items-center justify-between">
					<p class="text-sm font-medium text-[var(--color-text)]">
						Cached repos
					</p>
					<button
						onclick={handleClearAll}
						class="text-xs text-[var(--color-error)] transition-colors hover:underline"
					>
						Clear all
					</button>
				</div>
				<ul class="space-y-2">
					{#each repos as repo}
						<li class="flex items-center justify-between gap-3 text-sm">
							<div class="min-w-0 flex-1">
								<p class="truncate font-mono text-[var(--color-text)]">
									{shortName(repo.repoUrl)}
								</p>
								<p class="text-xs text-[var(--color-text-tertiary)]">
									Analyzed {formatDate(repo.analyzedAt)}
								</p>
							</div>
							<button
								onclick={() => handleDelete(repo.repoUrl)}
								class="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--color-text-secondary)]
									transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-error)]"
								aria-label="Delete cached data for {shortName(repo.repoUrl)}"
							>
								Delete
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}
