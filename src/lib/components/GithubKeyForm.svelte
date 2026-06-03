<script lang="ts">
    import { env } from '$env/dynamic/public'
    import { isSelfHostedProxy, publicProxyUrl } from '$lib/cors-proxy'
    import { saveGithubToken } from '$lib/github-token.svelte'

    interface Props {
        compact?: boolean
        onsaved?: () => void
    }

    let { compact = false, onsaved }: Props = $props()

    const corsProxy = env.PUBLIC_CORS_PROXY_URL || publicProxyUrl
    const selfHosted = isSelfHostedProxy(corsProxy)

    const createTokenUrl = 'https://github.com/settings/personal-access-tokens/new'
    const sourceUrl = 'https://github.com/vdavid/gitstrata/blob/main/src/lib/github-token.svelte.ts'
    const deployingUrl = 'https://github.com/vdavid/gitstrata/blob/main/docs/deploying.md'

    let tokenInput = $state('')
    let saving = $state(false)
    let errorMsg = $state('')

    const save = async () => {
        if (saving || !tokenInput.trim()) return
        errorMsg = ''
        saving = true
        try {
            await saveGithubToken(tokenInput)
            tokenInput = ''
            onsaved?.()
        } catch (e) {
            errorMsg = e instanceof Error ? e.message : 'Something went wrong. Try again.'
        } finally {
            saving = false
        }
    }
</script>

{#if !selfHosted}
    <div class={compact ? 'text-xs' : 'text-sm'} style="font-family: var(--font-sans);">
        <p class="text-foreground-secondary">
            Private repos need a self-hosted CORS proxy. On the shared public proxy your token would pass through a
            third party, so we don't offer it here. Deploy your own proxy to analyze private repos with a token.
        </p>
        <a
            href={deployingUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 inline-block text-accent hover:underline"
        >
            How to self-host →
        </a>
    </div>
{:else}
    <div class={compact ? 'text-xs' : 'text-sm'} style="font-family: var(--font-sans);">
        {#if !compact}
            <p class="mb-3 text-foreground-secondary">
                You can analyze your private GitHub repos with a personal access token. Steps:
            </p>
        {/if}

        <ol class="ml-4 list-decimal space-y-1 text-foreground-secondary">
            <li>
                <a href={createTokenUrl} target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">
                    Create a fine-grained token
                </a>
                on GitHub.
            </li>
            <li>Under <em>Repository access</em>, pick all repos (or just the ones you want).</li>
            <li>
                Under <em>Permissions</em>, click <em>+ Add permissions</em>. Add <em>Contents</em> with
                <span class="font-medium text-foreground">Access: read-only</span>.
            </li>
            <li>Generate it, copy it, and paste it below. (You can remove it anytime.)</li>
        </ol>

        <form
            onsubmit={(e) => {
                e.preventDefault()
                void save()
            }}
            class="mt-3"
        >
            <label for="github-token-input" class="sr-only">GitHub token</label>
            <input
                id="github-token-input"
                type="password"
                autocomplete="off"
                bind:value={tokenInput}
                placeholder="github_pat_…"
                disabled={saving}
                class="w-full border border-border bg-surface-raised px-3 py-2 text-sm text-foreground
					placeholder:text-foreground-tertiary focus:border-accent disabled:opacity-50"
                style="font-family: var(--font-mono); letter-spacing: 0.01em; border-radius: 6px; outline: none;
					transition: border-color var(--duration-fast) var(--ease-out-expo);"
            />
            {#if errorMsg}
                <p class="mt-2 text-xs text-error" style="font-family: var(--font-sans);">{errorMsg}</p>
            {/if}
            <button type="submit" disabled={saving || !tokenInput.trim()} class="btn-primary mt-2 text-sm">
                {saving ? 'Verifying…' : 'Save token'}
            </button>
        </form>

        <p class="mt-3 text-xs leading-relaxed text-foreground-tertiary" style="font-family: var(--font-sans);">
            All processing happens in <strong>your browser</strong>. Your code <strong>never</strong> touches our
            servers.<br />
            Your token is stored on your device, <strong>never</strong> our servers. Our proxy only forwards it to
            GitHub to authenticate you.
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">
                See how our code handles your token.
            </a>
        </p>
    </div>
{/if}
