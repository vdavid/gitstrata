<script lang="ts">
    import '../app.css'
    import { resolve } from '$app/paths'
    import { env } from '$env/dynamic/public'
    import ThemeToggle from '$lib/components/ThemeToggle.svelte'
    import CacheManager from '$lib/components/CacheManager.svelte'
    import KeyboardHelp from '$lib/components/KeyboardHelp.svelte'

    let { children } = $props()

    const analyticsId = env.PUBLIC_ANALYTICS_ID
    const analyticsUrl = env.PUBLIC_ANALYTICS_URL
</script>

<svelte:head>
    {#if analyticsId && analyticsUrl}
        <script defer data-website-id={analyticsId} src="{analyticsUrl}/script.js"></script>
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
            <a href={resolve('/')} class="group flex items-center gap-3 text-[var(--color-text)]">
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
                    <rect x="2" y="9" width="20" height="3" rx="1" fill="var(--color-accent-muted)" opacity="0.6" />
                    <rect x="2" y="14" width="20" height="3" rx="1" fill="var(--color-text-tertiary)" opacity="0.4" />
                    <rect x="2" y="19" width="20" height="3" rx="1" fill="var(--color-text-tertiary)" opacity="0.2" />
                </svg>
                <span
                    class="font-[var(--font-mono)] text-sm font-medium tracking-wide"
                    style="font-family: var(--font-mono);"
                >
                    git strata
                </span>
            </a>
            <div class="flex items-center">
                <a
                    href="https://github.com/vdavid/gitstrata"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="group relative flex h-11 w-11 items-center justify-center rounded-md
						text-[var(--color-text-tertiary)] transition-all
						hover:text-[var(--color-accent)]"
                    style="transition-duration: var(--duration-fast); transition-timing-function: var(--ease-out-expo);"
                    aria-label="View source on GitHub"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path
                            d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
                        />
                    </svg>
                </a>
                <ThemeToggle />
            </div>
        </div>
        <div class="strata-line mx-auto mt-4 max-w-5xl 2xl:max-w-7xl"></div>
    </header>

    <main id="main-content" class="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10 2xl:max-w-7xl">
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
