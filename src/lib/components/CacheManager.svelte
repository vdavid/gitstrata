<script lang="ts">
	import { browser } from '$app/environment';
	import {
		listCachedRepos,
		deleteRepo,
		clearAll,
		getTotalSize,
		formatBytes,
		type CachedRepoInfo
	} from '$lib/cache';

	interface Props {
		id?: string;
	}

	let { id }: Props = $props();

	let repos = $state<CachedRepoInfo[]>([]);
	let totalSize = $state(0);
	let expanded = $state(false);

	const load = async () => {
		if (!browser) return;
		repos = await listCachedRepos();
		totalSize = await getTotalSize();
	};

	$effect(() => {
		load();
	});

	const handleDelete = async (repoUrl: string) => {
		await deleteRepo(repoUrl);
		await load();
	};

	const handleClearAll = async () => {
		await clearAll();
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
	<div {id} class="mx-auto max-w-2xl">
		<button
			onclick={() => (expanded = !expanded)}
			aria-expanded={expanded}
			class="flex items-center gap-1.5 text-[var(--color-text-tertiary)] transition-colors
				hover:text-[var(--color-text-secondary)]"
			style="font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.02em; transition-duration: var(--duration-fast);"
		>
			<svg
				width="12" height="12" viewBox="0 0 24 24" fill="none"
				stroke="currentColor" stroke-width="2"
				stroke-linecap="round" stroke-linejoin="round"
				aria-hidden="true"
				class="transition-transform duration-200"
				style:transform={expanded ? 'rotate(90deg)' : 'rotate(0deg)'}
			>
				<polyline points="9 18 15 12 9 6" />
			</svg>
			{expanded ? 'hide' : 'manage'} cached repos ({repos.length}, {formatBytes(totalSize)})
		</button>

		{#if expanded}
			<div class="strata-card strata-fade-in mt-3 p-4 text-left">
				<div class="mb-3 flex items-center justify-between">
					<p
						class="text-[var(--color-text)]"
						style="font-family: var(--font-sans); font-size: 0.8125rem; font-weight: 500;"
					>
						Cached repos
						<span
							class="font-normal text-[var(--color-text-tertiary)]"
							style="font-family: var(--font-mono); font-size: 0.6875rem;"
						>
							({formatBytes(totalSize)})
						</span>
					</p>
					<button
						onclick={handleClearAll}
						class="text-xs text-[var(--color-error)] transition-colors hover:underline"
						style="font-family: var(--font-mono); letter-spacing: 0.02em; transition-duration: var(--duration-fast);"
					>
						clear all
					</button>
				</div>
				<ul class="space-y-2">
					{#each repos as repo (repo.repoUrl)}
						<li class="flex items-center justify-between gap-3">
							<div class="min-w-0 flex-1">
								<p
									class="truncate text-[var(--color-text)]"
									style="font-family: var(--font-mono); font-size: 0.8125rem;"
								>
									{shortName(repo.repoUrl)}
								</p>
								<p
									class="text-[var(--color-text-tertiary)]"
									style="font-family: var(--font-mono); font-size: 0.625rem; letter-spacing: 0.02em;"
								>
									{formatDate(repo.analyzedAt)} / {formatBytes(repo.sizeBytes)}
								</p>
							</div>
							<button
								onclick={() => handleDelete(repo.repoUrl)}
								class="btn-ghost shrink-0 px-2 py-1 text-xs"
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
