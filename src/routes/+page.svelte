<script lang="ts">
    import { browser } from '$app/environment'
    import { goto } from '$app/navigation'
    import { resolve } from '$app/paths'
    import { page } from '$app/state'
    import { env } from '$env/dynamic/public'
    import { parseRepoUrl, parseRepoFromPathname } from '$lib/url'
    import { formatBytes, getResult, saveResult } from '$lib/cache'
    import { fetchServerResult, uploadServerResult } from '$lib/server-cache'
    import { createAnalyzer, type AnalyzerHandle } from '$lib/worker/analyzer.api'
    import type { AnalysisResult, DayStats, ErrorKind, ProgressEvent } from '$lib/types'
    import RepoInput from '$lib/components/RepoInput.svelte'
    import PipelineProgress from '$lib/components/PipelineProgress.svelte'
    import ResultsChart from '$lib/components/ResultsChart.svelte'
    import ResultsSummary from '$lib/components/ResultsSummary.svelte'
    import ResultsTable from '$lib/components/ResultsTable.svelte'
    import TigGitLogo from '$lib/components/TigGitLogo.svelte'

    const corsProxy = env.PUBLIC_CORS_PROXY_URL || 'https://cors.isomorphic-git.org'

    type Phase = 'idle' | 'cloning' | 'processing' | 'done' | 'error'

    let phase = $state<Phase>('idle')
    let errorMessage = $state('')
    let errorKind = $state<ErrorKind>('unknown')

    // Clone progress
    let clonePhase = $state('')
    let cloneLoaded = $state(0)
    let cloneTotal = $state(0)
    let cloneStartTime = $state(0)
    let cloneElapsed = $state(0)

    // Process progress
    let processCurrent = $state(0)
    let processTotal = $state(0)
    let processDate = $state('')
    let processStartTime = $state(0)
    let processElapsed = $state(0)

    // Results (progressive and final)
    let streamingDays = $state<DayStats[]>([])
    let streamingLanguages = $state<string[]>([])
    let result = $state<AnalysisResult | undefined>()
    let cachedResult = $state<AnalysisResult | undefined>()
    let fromServerCache = $state(false)

    // Timer interval
    let timerInterval = $state<ReturnType<typeof setInterval> | undefined>()

    // Streaming day-result buffer — flushed to streamingDays every 2s to avoid chart thrashing
    let dayBuffer: DayStats[] = []
    let dayFlushTimeout: ReturnType<typeof setTimeout> | undefined

    // Worker handle
    let analyzer = $state<AnalyzerHandle | undefined>()

    /** Cancel the worker, await HTTP cleanup, then terminate. */
    const cancelAndTerminate = async (handle: AnalyzerHandle) => {
        await handle.cancel()
        handle.terminate()
    }

    // Terminate the worker on component unmount to prevent zombie workers
    $effect(() => {
        return () => {
            if (analyzer) void cancelAndTerminate(analyzer)
        }
    })

    // Share link feedback
    let shareCopied = $state(false)

    const hostToForgeNameMap: Record<string, string> = {
        'github.com': 'GitHub',
        'gitlab.com': 'GitLab',
        'bitbucket.org': 'Bitbucket',
    }

    const forgeName = (repoUrl: string): string => {
        try {
            const host = new URL(repoUrl).hostname.toLowerCase()
            return hostToForgeNameMap[host] ?? host
        } catch {
            return 'repo'
        }
    }

    // Focus management: reference to progress area
    let progressAreaEl: HTMLDivElement | undefined = $state()

    // Last repo input for retry
    let lastRepoInput = $state('')

    // Snapshot of the result we're refreshing from, so retry can re-attempt a failed refresh
    let pendingRefresh: AnalysisResult | undefined

    // Size warning (during clone, from worker)
    let sizeWarningBytes = $state(0)
    let showSizeWarning = $state(false)

    // Pre-clone size gate (from forge API)
    const sizeGateThresholdBytes = 500 * 1024 * 1024
    let sizeGateBytes = $state(0)

    // Repo size for display in summary (from forge API, null if unavailable)
    let repoSizeBytes: number | null = $state(null)

    // Read repo from URL pathname (e.g. /github.com/owner/repo)
    const initialRepo = $derived.by(() => {
        if (!browser) return ''
        const parsed = parseRepoFromPathname(page.url.pathname)
        return parsed ? parsed.url : ''
    })

    let autoStartedRepo = $state('')

    $effect(() => {
        if (browser && initialRepo && initialRepo !== autoStartedRepo) {
            autoStartedRepo = initialRepo
            void startAnalysis(initialRepo)
        }
    })

    const startTimer = (kind: 'clone' | 'process') => {
        stopTimer()
        const startTime = Date.now()
        if (kind === 'clone') {
            cloneStartTime = startTime
        } else {
            processStartTime = startTime
        }
        timerInterval = setInterval(() => {
            if (kind === 'clone') {
                cloneElapsed = Date.now() - cloneStartTime
            } else {
                processElapsed = Date.now() - processStartTime
            }
        }, 250)
    }

    const stopTimer = () => {
        if (timerInterval) {
            clearInterval(timerInterval)
            timerInterval = undefined
        }
    }

    const flushDayBuffer = () => {
        if (dayBuffer.length === 0) return
        streamingDays = [...streamingDays, ...dayBuffer]
        updateStreamingLanguages(dayBuffer[dayBuffer.length - 1])
        dayBuffer = []
        dayFlushTimeout = undefined
    }

    const resetState = () => {
        phase = 'idle'
        errorMessage = ''
        errorKind = 'unknown'
        clonePhase = ''
        cloneLoaded = 0
        cloneTotal = 0
        cloneElapsed = 0
        processCurrent = 0
        processTotal = 0
        processDate = ''
        processElapsed = 0
        streamingDays = []
        streamingLanguages = []
        dayBuffer = []
        if (dayFlushTimeout) clearTimeout(dayFlushTimeout)
        dayFlushTimeout = undefined
        result = undefined
        cachedResult = undefined
        fromServerCache = false
        sizeWarningBytes = 0
        showSizeWarning = false
        sizeGateBytes = 0
        repoSizeBytes = null
        pendingRefresh = undefined
        stopTimer()
    }

    const updateUrl = (repo: string) => {
        if (!repo) {
            goto(resolve('/'), { replaceState: true, keepFocus: true })
            return
        }
        try {
            const parsed = parseRepoUrl(repo)
            // eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve('/') is embedded in template
            goto(`${resolve('/')}${parsed.host}/${parsed.owner}/${parsed.repo}`, {
                replaceState: true,
                keepFocus: true,
            })
        } catch {
            goto(resolve('/'), { replaceState: true, keepFocus: true })
        }
    }

    const handleProgress = (event: ProgressEvent) => {
        // Ignore stale events that arrive after cancel (the worker may still send
        // an abort-triggered error before terminate() kills it)
        if (!analyzer) return

        switch (event.type) {
            case 'clone':
                phase = 'cloning'
                clonePhase = event.phase
                cloneLoaded = event.loaded
                cloneTotal = event.total
                break
            case 'process':
                if (phase !== 'processing') {
                    phase = 'processing'
                    stopTimer()
                    startTimer('process')
                }
                processCurrent = event.current
                processTotal = event.total
                processDate = event.date
                break
            case 'day-result':
                dayBuffer.push(event.day)
                if (!dayFlushTimeout) {
                    dayFlushTimeout = setTimeout(flushDayBuffer, 2000)
                }
                break
            case 'done':
                stopTimer()
                if (dayFlushTimeout) clearTimeout(dayFlushTimeout)
                flushDayBuffer()
                if (repoSizeBytes != null) event.result.repoSizeBytes = repoSizeBytes
                result = event.result
                cachedResult = event.result
                phase = 'done'
                void saveResult(event.result)
                void uploadServerResult(event.result)
                break
            case 'error':
                stopTimer()
                if (dayFlushTimeout) clearTimeout(dayFlushTimeout)
                dayBuffer = []
                phase = 'error'
                errorMessage = event.message
                errorKind = event.kind
                break
            case 'size-warning':
                sizeWarningBytes = event.estimatedBytes
                showSizeWarning = true
                break
        }
    }

    const updateStreamingLanguages = (day: DayStats) => {
        const seen: Record<string, true> = {}
        for (const langId of streamingLanguages) {
            seen[langId] = true
        }
        for (const langId of Object.keys(day.languages)) {
            seen[langId] = true
        }
        // Sort by line count in latest day (desc)
        const langTotals: Record<string, number> = {}
        for (const d of streamingDays) {
            for (const [id, lc] of Object.entries(d.languages)) {
                langTotals[id] = lc.total
            }
        }
        streamingLanguages = Object.keys(seen).sort((a, b) => (langTotals[b] ?? 0) - (langTotals[a] ?? 0))
    }

    /** Fetch repo size in bytes from the forge API. Returns null if unavailable. */
    const fetchRepoSizeBytes = async (host: string, owner: string, repo: string): Promise<number | null> => {
        try {
            if (host === 'github.com') {
                const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                    signal: AbortSignal.timeout(5000),
                })
                if (!resp.ok) return null
                const data = await resp.json()
                return typeof data.size === 'number' ? data.size * 1024 : null
            }
            // GitLab/Bitbucket: size not reliably available without auth
            return null
        } catch {
            return null
        }
    }

    const formatGb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1)

    const startAnalysis = async (repoInput: string, force = false) => {
        // Cancel any running analysis
        cancel()
        resetState()
        lastRepoInput = repoInput

        try {
            const parsed = parseRepoUrl(repoInput)
            autoStartedRepo = repoInput // Prevent the URL-watching effect from re-triggering
            updateUrl(repoInput)

            // Fetch repo size for display (fire-and-forget, non-blocking)
            void fetchRepoSizeBytes(parsed.host, parsed.owner, parsed.repo).then((size) => {
                repoSizeBytes = size
            })

            // Check local cache first
            const cached = await getResult(parsed.url)
            if (cached) {
                cachedResult = cached
                result = cached
                repoSizeBytes = cached.repoSizeBytes ?? null
                phase = 'done'
                return
            }

            // Check shared server cache on local miss
            const serverEntry = await fetchServerResult(parsed.url)
            if (serverEntry) {
                cachedResult = serverEntry.result
                result = serverEntry.result
                repoSizeBytes = serverEntry.result.repoSizeBytes ?? null
                fromServerCache = true
                phase = 'done'
                void saveResult(serverEntry.result)
                return
            }

            // Pre-clone size gate (GitHub only, skipped on force or API failure)
            if (!force) {
                const sizeBytes = await fetchRepoSizeBytes(parsed.host, parsed.owner, parsed.repo)
                if (sizeBytes !== null && sizeBytes > sizeGateThresholdBytes) {
                    sizeGateBytes = sizeBytes
                    return
                }
            }

            // Wait for any previous worker's HTTP cleanup before opening new connections
            if (cancelCleanup) {
                await cancelCleanup
                cancelCleanup = undefined
            }

            phase = 'cloning'
            startTimer('clone')

            analyzer = createAnalyzer()

            // Move focus to progress area for screen readers
            requestAnimationFrame(() => {
                progressAreaEl?.focus()
            })

            await analyzer.analyze(repoInput, corsProxy, handleProgress)
        } catch (e) {
            stopTimer()
            if (phase !== 'error') {
                phase = 'error'
                errorMessage = e instanceof Error ? e.message : 'Analysis failed'
                errorKind = 'unknown'
            }
        }
    }

    const forceAnalysis = () => {
        void startAnalysis(lastRepoInput, true)
    }

    const dismissSizeGate = () => {
        sizeGateBytes = 0
    }

    let cancelCleanup: Promise<void> | undefined

    const cancel = () => {
        stopTimer()
        if (analyzer) {
            cancelCleanup = cancelAndTerminate(analyzer)
            analyzer = undefined
        }
        phase = 'idle'
    }

    const retry = () => {
        if (pendingRefresh) {
            // Re-attempt the failed refresh
            result = pendingRefresh
            pendingRefresh = undefined
            void refresh()
        } else if (lastRepoInput) {
            startAnalysis(lastRepoInput)
        }
    }

    const refresh = async () => {
        if (!result) return
        // Snapshot strips Svelte 5 reactivity proxies so the object can be sent to the worker via postMessage
        const previousResult = $state.snapshot(result) as AnalysisResult
        const repoUrl = previousResult.repoUrl
        pendingRefresh = previousResult

        // Keep showing cached results while refreshing
        streamingDays = [...previousResult.days]
        streamingLanguages = [...previousResult.detectedLanguages]
        cachedResult = previousResult
        result = undefined

        phase = 'cloning'
        startTimer('clone')

        try {
            if (analyzer) await cancelAndTerminate(analyzer)
            analyzer = createAnalyzer()
            await analyzer.analyzeIncremental(repoUrl, corsProxy, previousResult, handleProgress)
            pendingRefresh = undefined
        } catch (e) {
            stopTimer()
            // phase may have been set to 'error' by handleProgress during the await
            if ((phase as Phase) !== 'error') {
                phase = 'error'
                errorMessage = e instanceof Error ? e.message : 'Refresh failed'
                errorKind = 'unknown'
            }
        }
    }

    const copyShareLink = async () => {
        await navigator.clipboard.writeText(window.location.href)
        shareCopied = true
        setTimeout(() => (shareCopied = false), 2000)
    }

    /** Whether the error kind supports a retry button */
    const retryable = $derived(
        errorKind === 'cors-proxy-down' || errorKind === 'network-lost' || errorKind === 'unknown',
    )

    const displayDays = $derived(result?.days ?? streamingDays)
    const displayLanguages = $derived(result?.detectedLanguages ?? streamingLanguages)
    const isStreaming = $derived(phase === 'processing' && !result)
    let chartHighlightDate = $state<string | null>(null)

    /** Only days with actual commits (excludes gap-filled carry-forward days) */
    const commitDays = $derived(displayDays.filter((d) => d.comments.length === 0 || d.comments[0] !== '-'))

    const displayRepoSlug = $derived.by(() => {
        const input = result?.repoUrl ?? lastRepoInput
        if (!input) return ''
        try {
            const parsed = parseRepoUrl(input)
            return `${parsed.owner}/${parsed.repo}`
        } catch {
            return ''
        }
    })

    const dismissSizeWarning = () => {
        showSizeWarning = false
    }

    /** Relative date label: "today", "yesterday", "3 days ago", "2 weeks ago", etc. */
    const relativeDate = (iso: string): string => {
        const then = new Date(iso.slice(0, 10) + 'T00:00:00')
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const diffMs = today.getTime() - then.getTime()
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

        if (diffDays <= 0) return 'today'
        if (diffDays === 1) return 'yesterday'
        if (diffDays < 14) return `${diffDays} days ago`
        const weeks = Math.round(diffDays / 7)
        if (weeks < 8) return `${weeks} weeks ago`
        const months = Math.round(diffDays / 30)
        if (months < 12) return `${months} months ago`
        const years = Math.round(diffDays / 365)
        return `${years} ${years === 1 ? 'year' : 'years'} ago`
    }
</script>

<svelte:head>
    <title>git strata -- stratigraphy for your code</title>
</svelte:head>

<div class="space-y-8 sm:space-y-10">
    <!-- Hero section -->
    <div class="relative py-4 text-center sm:py-6">
        <div class="strata-hero-lines"></div>
        <div class="relative">
            <TigGitLogo />
            <p
                class="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-foreground-secondary sm:text-base"
                style="font-family: var(--font-sans);"
            >
                Visualize how any public git repo grew over time, broken down by language. Runs in your browser.
            </p>
        </div>
    </div>

    <!-- Input -->
    <div class="mx-auto max-w-2xl">
        <RepoInput
            onsubmit={startAnalysis}
            disabled={phase === 'cloning' || phase === 'processing'}
            initialValue={initialRepo}
        />
    </div>

    <!-- Error -->
    {#if phase === 'error'}
        <div class="strata-card strata-fade-in mx-auto max-w-2xl border-error p-4" role="alert">
            <div class="flex items-start gap-3">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-error)"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="mt-1 shrink-0"
                    aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <div class="min-w-0 flex-1">
                    <p class="text-sm text-error">{errorMessage}</p>
                    <div class="mt-3 flex items-center gap-3">
                        {#if retryable}
                            <button onclick={retry} class="btn-primary text-sm">
                                {errorKind === 'network-lost' ? 'Retry (resumes)' : 'Retry'}
                            </button>
                        {/if}
                        {#if errorKind === 'indexeddb-full'}
                            <button
                                onclick={() => {
                                    const el = document.getElementById('cache-manager')
                                    if (el) {
                                        el.scrollIntoView({ behavior: 'smooth' })
                                    }
                                }}
                                class="btn-primary text-sm"
                            >
                                Manage cache
                            </button>
                        {/if}
                        <button onclick={() => (phase = 'idle')} class="btn-link text-sm">
                            {retryable ? 'Cancel' : 'Try another repo'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <!-- Size gate -->
    {#if sizeGateBytes > 0 && phase === 'idle'}
        <div class="strata-card strata-fade-in mx-auto max-w-2xl border-warning p-4">
            <div class="flex items-start gap-3">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-warning)"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="mt-1 shrink-0"
                    aria-hidden="true"
                >
                    <path
                        d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                    />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div class="min-w-0 flex-1">
                    <p class="text-sm text-foreground">
                        This repo is ~{formatGb(sizeGateBytes)} GB. You probably don't want to load that in your browser.
                        But if you insist, it'll probably work &mdash; it'll just take a looong time and a few gigs of RAM.
                    </p>
                    <div class="mt-3 flex items-center gap-3">
                        <button onclick={forceAnalysis} class="btn-primary text-sm"> Load anyway </button>
                        <button onclick={dismissSizeGate} class="btn-link text-sm"> Try another repo </button>
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- Focus management: this live region receives programmatic focus (via requestAnimationFrame)
	     when analysis starts, so screen readers announce updates. tabindex={-1} allows programmatic
	     focus without adding to tab order. WCAG 4.1.3 compliant. -->
    <div
        bind:this={progressAreaEl}
        tabindex={-1}
        class="focus-visible:outline-none focus-visible:shadow-none"
        role="status"
        aria-live="polite"
        aria-atomic="false"
    >
        <!-- Pipeline progress -->
        {#if phase === 'cloning' || phase === 'processing'}
            <div class="mx-auto max-w-2xl strata-fade-in">
                <PipelineProgress
                    repoSlug={displayRepoSlug}
                    {phase}
                    {clonePhase}
                    {cloneLoaded}
                    {cloneTotal}
                    cloneElapsedMs={cloneElapsed}
                    {processCurrent}
                    {processTotal}
                    {processDate}
                    processElapsedMs={processElapsed}
                    oncancel={cancel}
                />
            </div>
        {/if}

        <!-- Size warning -->
        {#if showSizeWarning && phase === 'cloning'}
            <div class="strata-card strata-fade-in mx-auto max-w-2xl border-warning p-4 mt-4" role="alert">
                <div class="flex items-start gap-3">
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-warning)"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="mt-1 shrink-0"
                        aria-hidden="true"
                    >
                        <path
                            d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                        />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div class="min-w-0 flex-1">
                        <p class="text-sm text-foreground">
                            This repository is large (~{formatBytes(sizeWarningBytes)}). Downloading may take a while
                            and use significant storage.
                        </p>
                        <div class="mt-3 flex items-center gap-3">
                            <button onclick={dismissSizeWarning} class="btn-primary text-sm"> Continue </button>
                            <button onclick={cancel} class="btn-link text-sm"> Cancel </button>
                        </div>
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <!-- Results -->
    {#if displayDays.length > 0}
        <div class="space-y-8">
            {#if displayRepoSlug}
                <h2
                    class="strata-fade-in text-center text-sm text-foreground-tertiary"
                    style="font-family: var(--font-mono); font-weight: 400; letter-spacing: 0.02em;"
                >
                    <span class="text-accent">{displayRepoSlug}</span>
                </h2>
            {/if}

            <!-- Cached badge + refresh + share -->
            {#if result}
                <div class="flex flex-wrap items-center justify-center gap-3 strata-fade-in">
                    {#if cachedResult}
                        <span class="strata-badge">
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                            {fromServerCache ? 'Shared result' : 'Last analyzed'}: {cachedResult.analyzedAt.slice(
                                0,
                                10,
                            )} ({relativeDate(cachedResult.analyzedAt)})
                        </span>
                        <button onclick={refresh} aria-label="Refresh analysis with latest commits" class="btn-link">
                            Refresh
                        </button>
                    {/if}
                    <div class="flex items-center gap-3">
                        <button
                            onclick={copyShareLink}
                            aria-label={shareCopied
                                ? 'Repository link copied to clipboard'
                                : 'Copy repository link to clipboard'}
                            class="btn-ghost"
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            {shareCopied ? 'Copied!' : 'Copy link'}
                        </button>
                        <!-- eslint-disable svelte/no-navigation-without-resolve -- external URL, not a SvelteKit route -->
                        <a
                            href={result.repoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="btn-ghost"
                            aria-label="Open repository on {forgeName(result.repoUrl)}"
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                            Open on {forgeName(result.repoUrl)}
                        </a>
                        <!-- eslint-enable svelte/no-navigation-without-resolve -->
                    </div>
                </div>
            {/if}

            <!-- Summary stats -->
            <ResultsSummary
                days={displayDays}
                detectedLanguages={displayLanguages}
                {repoSizeBytes}
                onHighlightDate={(d) => (chartHighlightDate = d)}
            />

            <!-- Chart -->
            <ResultsChart
                days={displayDays}
                detectedLanguages={displayLanguages}
                live={isStreaming}
                highlightDate={chartHighlightDate}
            />

            <!-- Data table (collapsible, collapsed by default) -->
            {#if result}
                <details class="group">
                    <summary
                        class="cursor-pointer select-none py-2 text-sm text-foreground-secondary hover:text-foreground transition-colors"
                        style="font-family: var(--font-mono); font-size: 0.875rem; letter-spacing: 0.02em; transition-duration: var(--duration-fast);"
                    >
                        Data table ({commitDays.length}
                        {commitDays.length === 1 ? 'commit' : 'commits'})
                    </summary>
                    <div class="mt-4">
                        <ResultsTable
                            days={commitDays}
                            detectedLanguages={displayLanguages}
                            repoUrl={result?.repoUrl}
                        />
                    </div>
                </details>
            {/if}
        </div>
    {/if}
</div>
