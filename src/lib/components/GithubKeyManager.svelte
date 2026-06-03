<script lang="ts">
    import { maskToken } from '$lib/github-token'
    import { githubTokenState, deleteGithubToken } from '$lib/github-token.svelte'
    import GithubKeyForm from './GithubKeyForm.svelte'

    let open = $state(false)
    let containerEl = $state<HTMLElement>()

    const stored = $derived(githubTokenState.current)

    const formatDate = (iso: string): string => {
        try {
            return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        } catch {
            return iso
        }
    }

    // Close on outside click or Escape while open.
    $effect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            if (containerEl && !containerEl.contains(e.target as Node)) open = false
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') open = false
        }
        window.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('pointerdown', onPointerDown)
            window.removeEventListener('keydown', onKey)
        }
    })
</script>

<div class="relative" bind:this={containerEl}>
    <button
        onclick={() => (open = !open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        class="group relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-md
			text-foreground-tertiary transition-all hover:text-accent"
        style="transition-duration: var(--duration-fast); transition-timing-function: var(--ease-out-expo);"
        aria-label={stored ? 'Manage your GitHub token' : 'Add a GitHub token for private repos'}
    >
        <!-- Key icon -->
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path
                d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
            />
        </svg>

        <!-- Stored-key badge: a small checkmark, normal text color -->
        {#if stored}
            <span
                class="absolute bottom-1 right-1 flex items-center justify-center rounded-full bg-canvas"
                style="width: 11px; height: 11px;"
                aria-hidden="true"
            >
                <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-foreground)"
                    stroke-width="3.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            </span>
        {/if}
    </button>

    {#if open}
        <!-- Outer wrapper owns the positioning; the inner .strata-card sets position:relative, so it
             can't be the positioned layer itself or it falls back into flow and pushes content down. -->
        <div class="absolute right-0 z-50 mt-2 w-[32rem] max-w-[calc(100vw-2rem)]">
            <div class="strata-card strata-fade-in p-4 text-left" role="dialog" aria-label="GitHub token">
                {#if stored}
                    <p
                        class="text-foreground"
                        style="font-family: var(--font-sans); font-size: 0.875rem; font-weight: 500;"
                    >
                        GitHub token
                    </p>
                    <dl class="mt-2 space-y-1.5 text-xs" style="font-family: var(--font-sans);">
                        <div class="flex justify-between gap-3">
                            <dt class="text-foreground-tertiary">Account</dt>
                            <dd class="truncate text-foreground" style="font-family: var(--font-mono);">
                                @{stored.account}
                            </dd>
                        </div>
                        <div class="flex justify-between gap-3">
                            <dt class="text-foreground-tertiary">Token</dt>
                            <dd class="text-foreground" style="font-family: var(--font-mono);">
                                {maskToken(stored.token)}
                            </dd>
                        </div>
                        <div class="flex justify-between gap-3">
                            <dt class="text-foreground-tertiary">Added</dt>
                            <dd class="text-foreground">{formatDate(stored.addedAt)}</dd>
                        </div>
                    </dl>
                    <p
                        class="mt-3 text-xs leading-relaxed text-foreground-tertiary"
                        style="font-family: var(--font-sans);"
                    >
                        Stored on <strong>your device</strong>. We only forward it to GitHub to read your private repos.
                        Your code <strong>never</strong> touches gitstrata servers or any third party.
                    </p>
                    <button onclick={() => deleteGithubToken()} class="btn-ghost mt-3 px-3 py-1.5 text-xs text-error">
                        Delete key
                    </button>
                {:else}
                    <GithubKeyForm compact />
                {/if}
            </div>
            <!-- Caret pointing up to the key button. Painted in front of the card (later in DOM + z-10)
                 so its fill covers the card's top border, leaving only the two upper edges visible. The
                 background composites the same surface-overlay the card's ::after adds, so the lower half
                 blends invisibly into the card. -->
            <div
                class="absolute -top-[5px] right-[17px] z-10 h-[10px] w-[10px] rotate-45 border-l border-t border-border"
                style="background: linear-gradient(var(--color-surface-overlay), var(--color-surface-overlay)), var(--color-surface-raised);"
                aria-hidden="true"
            ></div>
        </div>
    {/if}
</div>
