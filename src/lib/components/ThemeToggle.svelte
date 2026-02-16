<script lang="ts">
    import { browser } from '$app/environment'

    type Theme = 'light' | 'dark'

    const getInitialTheme = (): Theme => {
        if (!browser) return 'light'
        const stored = localStorage.getItem('theme') as Theme | null
        if (stored) return stored
        return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    let theme = $state<Theme>(getInitialTheme())

    const applyTheme = (t: Theme) => {
        if (!browser) return
        document.documentElement.classList.toggle('dark', t === 'dark')
        localStorage.setItem('theme', t)
    }

    const toggle = () => {
        theme = theme === 'light' ? 'dark' : 'light'
        applyTheme(theme)
    }

    // Apply theme on mount
    $effect(() => {
        applyTheme(theme)
    })
</script>

<button
    onclick={toggle}
    class="group relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-md
		text-[var(--color-text-tertiary)] transition-all
		hover:text-[var(--color-accent)]"
    style="transition-duration: var(--duration-fast); transition-timing-function: var(--ease-out-expo);"
    aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
>
    {#if theme === 'light'}
        <!-- Sun icon -->
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
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
    {:else}
        <!-- Moon icon -->
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
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    {/if}
</button>
