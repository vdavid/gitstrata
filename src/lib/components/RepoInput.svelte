<script lang="ts">
    import { onMount } from 'svelte'
    import { parseRepoUrl } from '$lib/url'
    import { pickFeaturedRepos, pickPlaceholder } from '$lib/featured-repos'

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

    $effect(() => {
        if (initialValue) {
            inputValue = initialValue
        }
    })

    onMount(() => {
        const repos = pickFeaturedRepos(3)
        currentRepos = repos
        currentPlaceholder = pickPlaceholder(repos)
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
    </div>
</div>
