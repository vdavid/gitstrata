<script lang="ts">
    import { onMount } from 'svelte'
    import { parseRepoUrl } from '#lib/url.js'
    import { pickFeaturedRepos, pickPlaceholder } from '#lib/featured-repos.js'
    import { listCachedRepos } from '#lib/cache.js'
    import { loadVisitLog, rankRecentRepos } from '#lib/recent-repos.js'

    interface Props {
        onsubmit: (repoUrl: string) => void
        disabled?: boolean
        initialValue?: string
    }

    let { onsubmit, disabled = false, initialValue = '' }: Props = $props()

    let inputValue = $state('')
    let error = $state('')
    let currentRepos = $state<{ owner: string; repo: string }[]>([])
    let currentPlaceholder = $state('Example: https://github.com/sveltejs/svelte')
    let genKey = $state(0)
    let inputEl = $state<HTMLInputElement>()

    // Repos this browser has analyzed, best "recent favorite" first. Replaces the featured row when non-empty.
    let recentRepoUrls = $state<string[]>([])
    let showAllRecent = $state(false)
    const recentCollapsedCount = 3
    const visibleRecentRepoUrls = $derived(
        showAllRecent ? recentRepoUrls : recentRepoUrls.slice(0, recentCollapsedCount),
    )

    const loadRecentRepos = async () => {
        try {
            const cached = await listCachedRepos()
            recentRepoUrls = rankRecentRepos(
                cached.map((c) => c.repoUrl),
                Object.fromEntries(cached.map((c) => [c.repoUrl, c.lastAccessed])),
                loadVisitLog(),
                Date.now(),
            )
        } catch {
            // IndexedDB unavailable: keep the featured row
        }
    }

    /** "owner/repo" for GitHub (the shorthand the input accepts), "host/owner/repo" elsewhere */
    const formatRepoLabel = (repoUrl: string): string => {
        const label = repoUrl.replace(/^https?:\/\//, '')
        return label.startsWith('github.com/') ? label.slice('github.com/'.length) : label
    }

    /** Move focus to the URL field — used on load and when reopening from an error. */
    export function focus() {
        inputEl?.focus()
    }

    $effect(() => {
        if (initialValue) {
            inputValue = initialValue
        }
    })

    onMount(() => {
        const repos = pickFeaturedRepos(3)
        currentRepos = repos
        currentPlaceholder = pickPlaceholder(repos)
        // Focus the field on a fresh load (no deep-linked repo analyzing).
        if (!initialValue && !disabled) inputEl?.focus()

        void loadRecentRepos()
        const handleCacheChange = () => void loadRecentRepos()
        window.addEventListener('cache-changed', handleCacheChange)
        return () => window.removeEventListener('cache-changed', handleCacheChange)
    })

    const handleMore = () => {
        const repos = pickFeaturedRepos(3)
        currentRepos = repos
        currentPlaceholder = pickPlaceholder(repos)
        genKey++
    }

    const validate = (value: string): string | undefined => {
        try {
            parseRepoUrl(value)
            return undefined
        } catch (e) {
            return e instanceof Error ? e.message : 'Invalid repository URL'
        }
    }

    const handleSubmit = () => {
        const trimmed = inputValue.trim()
        if (!trimmed) {
            error = 'Enter a repository URL to get started'
            return
        }

        const validationError = validate(trimmed)
        if (validationError) {
            error = validationError
            return
        }

        error = ''
        onsubmit(trimmed)
    }

    const handleExample = (value: string) => {
        inputValue = value
        error = ''
        onsubmit(value)
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
        }
    }

    const handleInput = () => {
        if (error) {
            const trimmed = inputValue.trim()
            if (trimmed) {
                const validationError = validate(trimmed)
                error = validationError ?? ''
            } else {
                error = ''
            }
        }
    }
</script>

<div class="w-full">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div class="relative flex-1">
            <input
                bind:this={inputEl}
                type="url"
                bind:value={inputValue}
                onkeydown={handleKeydown}
                oninput={handleInput}
                placeholder={currentPlaceholder}
                {disabled}
                class="w-full border bg-surface-raised px-4 py-3
					text-sm text-foreground placeholder:text-foreground-tertiary
					{error ? 'border-error' : 'border-border focus:border-accent'}
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
                    class="mt-2 text-xs text-error"
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
        class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-tertiary"
        style="font-family: var(--font-mono); letter-spacing: 0.02em;"
    >
        {#if recentRepoUrls.length > 0}
            <span>recent:</span>
            {#each visibleRecentRepoUrls as repoUrl, i (repoUrl)}
                {#if i > 0}
                    <span class="text-border-strong">/</span>
                {/if}
                <button
                    onclick={() => handleExample(formatRepoLabel(repoUrl))}
                    {disabled}
                    class="cursor-pointer text-foreground-secondary transition-colors
						hover:text-accent
						disabled:cursor-not-allowed disabled:opacity-50"
                    style="transition-duration: var(--duration-fast);"
                >
                    {formatRepoLabel(repoUrl)}
                </button>
            {/each}
            {#if recentRepoUrls.length > recentCollapsedCount}
                <span class="text-border-strong">/</span>
                <button
                    onclick={() => (showAllRecent = !showAllRecent)}
                    class="cursor-pointer text-foreground-tertiary transition-colors hover:text-accent"
                    style="transition-duration: var(--duration-fast);"
                    aria-expanded={showAllRecent}
                >
                    {showAllRecent ? 'less' : 'more'}
                </button>
            {/if}
        {:else}
            <span>try:</span>
            {#key genKey}
                {#each currentRepos as repo, i (`${repo.owner}/${repo.repo}`)}
                    {#if i > 0}
                        <span class="text-border-strong">/</span>
                    {/if}
                    <button
                        onclick={() => handleExample(`${repo.owner}/${repo.repo}`)}
                        {disabled}
                        class="strata-fade-in cursor-pointer text-foreground-secondary transition-colors
						hover:text-accent
						disabled:cursor-not-allowed disabled:opacity-50"
                        style="transition-duration: var(--duration-fast); animation-delay: {i * 60}ms;"
                    >
                        {repo.owner}/{repo.repo}
                    </button>
                {/each}
            {/key}
            {#if currentRepos.length > 0}
                <span class="text-border-strong">/</span>
                <button
                    onclick={handleMore}
                    {disabled}
                    class="cursor-pointer text-foreground-tertiary transition-colors
					hover:text-accent
					disabled:cursor-not-allowed disabled:opacity-50"
                    style="transition-duration: var(--duration-fast);"
                >
                    more
                </button>
            {/if}
        {/if}
    </div>
</div>
