<script lang="ts">
    import { browser } from '$app/environment'
    import { getLanguages } from '$lib/languages'
    import type { DayStats } from '$lib/types'
    import type { Chart as ChartType, ChartConfiguration, ChartDataset } from 'chart.js'
    import { areaLabelsPlugin } from './chart-area-labels-plugin'
    import { crosshairPlugin } from './chart-crosshair-plugin'

    interface Props {
        days: DayStats[]
        /** Language ids sorted by final-day line count desc */
        detectedLanguages: string[]
        /** Whether data is still streaming in */
        live?: boolean
        /** When set, the chart highlights this date (crosshair + strip data) */
        highlightDate?: string | null
    }

    let { days, detectedLanguages, live = false, highlightDate = null }: Props = $props()

    type ViewMode = 'all' | 'prod-vs-test' | 'languages-only'
    const viewModeToggles: { mode: ViewMode; label: string }[] = [
        { mode: 'all', label: 'All' },
        { mode: 'prod-vs-test', label: 'Prod vs test' },
        { mode: 'languages-only', label: 'Languages only' },
    ]
    let viewMode = $state<ViewMode>('all')
    let patternFills = $state(false)

    let canvasEl: HTMLCanvasElement | undefined = $state()
    let chart: ChartType | undefined = $state()
    let chartReady = $state(false)

    // --- Detail strip (replaces floating tooltip) ---
    interface StripItem {
        label: string
        value: number
        color: string
        pct: number
    }
    let hoverStripItems = $state<StripItem[]>([])
    let hoverStripDate = $state('')
    let hoverStripTotal = $state(0)
    let isHovering = $state(false)
    let idleStripItems = $state<StripItem[]>([])
    let idleStripDate = $state('')
    let idleStripTotal = $state(0)
    let touchTimeout: ReturnType<typeof setTimeout> | undefined

    /** Format a number with thin-space thousands separator */
    const formatStripNumber = (n: number): string => n.toLocaleString('en').replace(/,/g, '\u2009')

    /** Abbreviate dataset labels for mobile (shorten prod/test suffix) */
    const abbreviateLabel = (label: string): string =>
        label.replace(/\s*\(prod\)$/, ' (p)').replace(/\s*\(test\)$/, ' (t)')

    const computeStripFromDatasets = (datasets: ChartDataset<'line'>[], dataIndex: number) => {
        const items: StripItem[] = []
        let total = 0
        for (const ds of datasets) {
            const raw = ds.data[dataIndex]
            const val = typeof raw === 'number' ? raw : 0
            total += val
            items.push({
                label: ds.label ?? '',
                value: val,
                color: typeof ds.borderColor === 'string' ? ds.borderColor : '',
                pct: 0,
            })
        }
        for (const item of items) {
            item.pct = total > 0 ? Math.round((item.value / total) * 100) : 0
        }
        return { items, total }
    }

    const activeStrip = $derived.by(() => {
        if (isHovering && hoverStripItems.length > 0) {
            return { items: hoverStripItems, total: hoverStripTotal, date: hoverStripDate, hovering: true }
        }
        if (idleStripItems.length > 0) {
            return { items: idleStripItems, total: idleStripTotal, date: idleStripDate, hovering: false }
        }
        return null
    })

    const handleExternalTooltip = (context: {
        tooltip: {
            opacity: number
            title?: string[]
            dataPoints: { dataset: ChartDataset<'line'>; dataIndex: number }[]
        }
    }) => {
        const { tooltip } = context
        if (tooltip.opacity === 0) {
            isHovering = false
            return
        }
        isHovering = true
        hoverStripDate = tooltip.title?.[0] ?? ''

        const items: StripItem[] = []
        let total = 0
        for (const dp of tooltip.dataPoints) {
            const raw = dp.dataset.data[dp.dataIndex]
            const val = typeof raw === 'number' ? raw : 0
            total += val
            items.push({
                label: dp.dataset.label ?? '',
                value: val,
                color: typeof dp.dataset.borderColor === 'string' ? dp.dataset.borderColor : '',
                pct: 0,
            })
        }
        for (const item of items) {
            item.pct = total > 0 ? Math.round((item.value / total) * 100) : 0
        }
        hoverStripItems = items
        hoverStripTotal = total
    }

    const handleTouchEnd = () => {
        if (touchTimeout) clearTimeout(touchTimeout)
        touchTimeout = setTimeout(() => {
            isHovering = false
            if (chart) {
                ;(chart as unknown as Record<string, unknown>).__crosshairX = undefined
                chart.draw()
            }
        }, 1500)
    }

    // Track theme so the chart re-reads CSS variables on light/dark switch
    let isDark = $state(browser && document.documentElement.classList.contains('dark'))
    $effect(() => {
        if (!browser) return
        const observer = new MutationObserver(() => {
            isDark = document.documentElement.classList.contains('dark')
        })
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    })

    // Dynamic import to avoid SSR issues with hammerjs
    let ChartConstructor: typeof ChartType | undefined = $state()

    $effect(() => {
        if (browser && !ChartConstructor) {
            loadChart()
        }
    })

    const loadChart = async () => {
        const [chartModule, adapterModule, zoomModule] = await Promise.all([
            import('chart.js'),
            import('chartjs-adapter-date-fns'),
            import('chartjs-plugin-zoom'),
        ])
        void adapterModule // side-effect import

        const { Chart, LineController, LineElement, PointElement, Filler, LinearScale, TimeScale, Tooltip, Legend } =
            chartModule

        Chart.register(
            LineController,
            LineElement,
            PointElement,
            Filler,
            LinearScale,
            TimeScale,
            Tooltip,
            Legend,
            zoomModule.default,
            crosshairPlugin,
            areaLabelsPlugin,
        )

        ChartConstructor = Chart
        chartReady = true
    }

    const languageNameMap = $derived.by(() => {
        const entries: [string, string][] = getLanguages().map((lang) => [lang.id, lang.name])
        return Object.fromEntries(entries) as Record<string, string>
    })

    const langName = (id: string): string => languageNameMap[id] ?? id

    /** Read a CSS custom property from :root */
    const getCssVar = (name: string): string => {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    }

    const getChartColor = (index: number): string => getCssVar(`--chart-${index + 1}`)
    const getChartTint = (index: number): string => getCssVar(`--chart-${index + 1}-tint`)

    /** Determine which languages get their own layer (>= 5% of total at latest point) */
    const computeVisibleLanguages = (daysList: DayStats[], allLangs: string[]): { shown: string[]; other: boolean } => {
        if (daysList.length === 0) return { shown: [], other: false }
        const last = daysList[daysList.length - 1]
        const totalAtEnd = last.total || 1

        const shown: string[] = []
        let hasOther = false

        for (const langId of allLangs) {
            const lc = last.languages[langId]
            if (!lc || lc.total <= 0) continue
            if (lc.total / totalAtEnd >= 0.05) {
                shown.push(langId)
            } else {
                hasOther = true
            }
        }

        return { shown, other: hasOther }
    }

    /** Whether a language's test layer should be shown separately (>= 10% of that language) */
    const shouldSplitTestLayer = (daysList: DayStats[], langId: string): boolean => {
        if (daysList.length === 0) return false
        const last = daysList[daysList.length - 1]
        const lc = last.languages[langId]
        if (!lc || lc.prod === undefined || lc.test === undefined) return false
        return lc.total > 0 && lc.test / lc.total >= 0.1
    }

    const maxChartColors = 12

    type PatternStyle = 'diagonal' | 'dots' | 'crosshatch' | 'horizontal' | 'vertical' | 'zigzag'
    const patternStyles: PatternStyle[] = ['diagonal', 'dots', 'crosshatch', 'horizontal', 'vertical', 'zigzag']

    /** Create a canvas pattern with a given style and color */
    const createPattern = (color: string, style: PatternStyle): CanvasPattern | string => {
        const size = 10
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return color

        // Fill background with semi-transparent color
        ctx.fillStyle = color
        ctx.fillRect(0, 0, size, size)

        // Draw pattern overlay in a darker version
        ctx.strokeStyle = getCssVar('--color-text')
        ctx.globalAlpha = 0.3
        ctx.lineWidth = 1.5

        switch (style) {
            case 'diagonal':
                ctx.beginPath()
                ctx.moveTo(0, size)
                ctx.lineTo(size, 0)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(-size / 2, size / 2)
                ctx.lineTo(size / 2, -size / 2)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(size / 2, size + size / 2)
                ctx.lineTo(size + size / 2, size / 2)
                ctx.stroke()
                break
            case 'dots':
                ctx.beginPath()
                ctx.arc(size / 2, size / 2, 2, 0, Math.PI * 2)
                ctx.fillStyle = getCssVar('--color-text')
                ctx.globalAlpha = 0.3
                ctx.fill()
                break
            case 'crosshatch':
                ctx.beginPath()
                ctx.moveTo(0, size)
                ctx.lineTo(size, 0)
                ctx.moveTo(0, 0)
                ctx.lineTo(size, size)
                ctx.stroke()
                break
            case 'horizontal':
                ctx.beginPath()
                ctx.moveTo(0, size / 2)
                ctx.lineTo(size, size / 2)
                ctx.stroke()
                break
            case 'vertical':
                ctx.beginPath()
                ctx.moveTo(size / 2, 0)
                ctx.lineTo(size / 2, size)
                ctx.stroke()
                break
            case 'zigzag':
                ctx.beginPath()
                ctx.moveTo(0, size * 0.75)
                ctx.lineTo(size / 2, size * 0.25)
                ctx.lineTo(size, size * 0.75)
                ctx.stroke()
                break
        }

        const pattern = canvasEl?.getContext('2d')?.createPattern(canvas, 'repeat')
        return pattern ?? color
    }

    /** Get background for a dataset: pattern if enabled, solid color otherwise */
    const getBackground = (color: string, index: number): string | CanvasPattern => {
        if (!patternFills) return color
        const style = patternStyles[index % patternStyles.length]
        return createPattern(color, style)
    }

    const buildDatasets = (
        daysList: DayStats[],
        shown: string[],
        hasOther: boolean,
        mode: ViewMode,
    ): ChartDataset<'line'>[] => {
        const datasets: ChartDataset<'line'>[] = []
        let dsIndex = 0

        if (mode === 'prod-vs-test') {
            const prodData = daysList.map((d) => {
                let prod = 0
                for (const lc of Object.values(d.languages)) {
                    prod += lc.prod ?? lc.total
                }
                return prod
            })
            const testData = daysList.map((d) => {
                let test = 0
                for (const lc of Object.values(d.languages)) {
                    test += lc.test ?? 0
                }
                return test
            })

            datasets.push({
                label: 'Production',
                data: prodData,
                backgroundColor: getBackground(getChartColor(0) + '80', dsIndex++),
                borderColor: getChartColor(0),
                borderWidth: 1.5,
                fill: 'origin',
                tension: 0.3,
                pointRadius: 0,
                pointHitRadius: 6,
            })
            datasets.push({
                label: 'Test',
                data: testData,
                backgroundColor: getBackground(getChartTint(0) + '80', dsIndex++),
                borderColor: getChartTint(0),
                borderWidth: 1.5,
                fill: '-1',
                tension: 0.3,
                pointRadius: 0,
                pointHitRadius: 6,
            })
            return datasets
        }

        shown.forEach((langId, i) => {
            const colorIdx = i % maxChartColors
            const splitTest = mode === 'all' && shouldSplitTestLayer(daysList, langId)

            if (splitTest) {
                const prodData = daysList.map((d) => {
                    const lc = d.languages[langId]
                    return lc?.prod ?? lc?.total ?? 0
                })
                datasets.push({
                    label: `${langName(langId)} (prod)`,
                    data: prodData,
                    backgroundColor: getBackground(getChartColor(colorIdx) + '80', dsIndex++),
                    borderColor: getChartColor(colorIdx),
                    borderWidth: 1.5,
                    fill: datasets.length === 0 ? 'origin' : '-1',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHitRadius: 6,
                })
                const testData = daysList.map((d) => {
                    const lc = d.languages[langId]
                    return lc?.test ?? 0
                })
                datasets.push({
                    label: `${langName(langId)} (test)`,
                    data: testData,
                    backgroundColor: getBackground(getChartTint(colorIdx) + '80', dsIndex++),
                    borderColor: getChartTint(colorIdx),
                    borderWidth: 1.5,
                    fill: datasets.length === 0 ? 'origin' : '-1',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHitRadius: 6,
                })
            } else {
                const totalData = daysList.map((d) => {
                    const lc = d.languages[langId]
                    return lc?.total ?? 0
                })
                datasets.push({
                    label: langName(langId),
                    data: totalData,
                    backgroundColor: getBackground(getChartColor(colorIdx) + '80', dsIndex++),
                    borderColor: getChartColor(colorIdx),
                    borderWidth: 1.5,
                    fill: datasets.length === 0 ? 'origin' : '-1',
                    tension: 0.3,
                    pointRadius: 0,
                    pointHitRadius: 6,
                })
            }
        })

        if (hasOther) {
            const shownSet = new Set(shown)
            const otherData = daysList.map((d) => {
                let sum = 0
                for (const [id, lc] of Object.entries(d.languages)) {
                    if (!shownSet.has(id)) sum += lc.total
                }
                return sum
            })
            datasets.push({
                label: 'Other',
                data: otherData,
                backgroundColor: getBackground(getCssVar('--chart-other') + '80', dsIndex++),
                borderColor: getCssVar('--chart-other'),
                borderWidth: 1.5,
                fill: datasets.length === 0 ? 'origin' : '-1',
                tension: 0.3,
                pointRadius: 0,
                pointHitRadius: 6,
            })
        }

        return datasets
    }

    const buildConfig = (daysList: DayStats[], datasets: ChartDataset<'line'>[]): ChartConfiguration<'line'> => {
        const labels = daysList.map((d) => d.date)
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

        return {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: reducedMotion ? false : { duration: 400 },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', tooltipFormat: 'yyyy-MM-dd' },
                        grid: { color: getCssVar('--color-border') + '30' },
                        ticks: {
                            color: getCssVar('--color-text-tertiary'),
                            maxTicksLimit: 12,
                            font: { family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''), size: 12 },
                        },
                        border: { color: getCssVar('--color-border') },
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: getCssVar('--color-border') + '30' },
                        ticks: {
                            color: getCssVar('--color-text-tertiary'),
                            font: { family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''), size: 12 },
                            callback: (value) => {
                                const v = value as number
                                if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
                                if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
                                return String(v)
                            },
                        },
                        border: { color: getCssVar('--color-border') },
                    },
                },
                plugins: {
                    tooltip: {
                        enabled: false,
                        external: handleExternalTooltip,
                    },
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: getCssVar('--color-text-secondary'),
                            padding: 16,
                            usePointStyle: true,
                            pointStyle: 'rectRounded',
                            font: {
                                family: getCssVar('--font-mono').split(',')[0].replace(/'/g, ''),
                                size: 12,
                            },
                        },
                    },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: {
                            wheel: { enabled: true },
                            pinch: { enabled: true },
                            mode: 'x',
                        },
                    },
                    crosshair: { enabled: true },
                    areaLabels: { enabled: true },
                },
            },
        }
    }

    const resetZoom = () => {
        chart?.resetZoom()
    }

    const ariaLabel = $derived.by(() => {
        if (days.length === 0) return 'Empty chart'
        const last = days[days.length - 1]
        const first = days[0]
        const totalLines =
            last.total >= 1_000_000
                ? `${(last.total / 1_000_000).toFixed(1)} million`
                : last.total >= 1_000
                  ? `${(last.total / 1_000).toFixed(0)} thousand`
                  : String(last.total)
        const langCount = detectedLanguages.length
        return `Stacked area chart showing ${totalLines} lines of code across ${langCount} languages from ${first.date} to ${last.date}`
    })

    // Render/update chart when days, viewMode, or theme change
    $effect(() => {
        if (!canvasEl || !chartReady || !ChartConstructor) return
        // Read isDark so this effect re-runs on theme switch, re-reading CSS variables
        void isDark

        const { shown, other: hasOther } = computeVisibleLanguages(days, detectedLanguages)
        const datasets = buildDatasets(days, shown, hasOther, viewMode)
        const config = buildConfig(days, datasets)

        if (chart) {
            chart.data = config.data
            if (config.options) {
                chart.options = config.options
            }
            chart.update(live ? 'none' : undefined)
        } else {
            chart = new ChartConstructor(canvasEl, config)
        }

        // Compute idle strip from the plain datasets array (not the proxied chart)
        const lastIdx = days.length - 1
        if (lastIdx >= 0) {
            const { items, total } = computeStripFromDatasets(datasets, lastIdx)
            idleStripItems = items
            idleStripDate = days[lastIdx].date
            idleStripTotal = total
        }
    })

    // External highlight (e.g. hovering the "Peak day" stat card)
    $effect(() => {
        if (!chart || days.length === 0) return
        const rec = chart as unknown as Record<string, unknown>

        if (!highlightDate) {
            // Clear highlight — revert to idle
            rec.__crosshairX = undefined
            isHovering = false
            chart.draw()
            return
        }

        const dataIndex = days.findIndex((d) => d.date === highlightDate)
        if (dataIndex < 0) return

        // Position crosshair at the date's x-pixel
        const xPixel = chart.scales.x.getPixelForValue(new Date(highlightDate).getTime())
        rec.__crosshairX = xPixel

        // Update strip with this date's data
        const datasets = chart.data.datasets as ChartDataset<'line'>[]
        const { items, total } = computeStripFromDatasets(datasets, dataIndex)
        hoverStripItems = items
        hoverStripDate = highlightDate
        hoverStripTotal = total
        isHovering = true

        chart.draw()
    })

    // Clean up on component destroy
    $effect(() => {
        return () => {
            chart?.destroy()
            chart = undefined
        }
    })
</script>

<div class="strata-card overflow-hidden">
    <!-- View toggles + reset zoom -->
    <div
        class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3"
        role="group"
        aria-label="Chart view mode"
    >
        {#each viewModeToggles as toggle (toggle.mode)}
            <button
                onclick={() => (viewMode = toggle.mode)}
                aria-pressed={viewMode === toggle.mode}
                class="strata-chip"
            >
                {toggle.label}
            </button>
        {/each}
        <div class="flex-1"></div>
        <button
            onclick={() => (patternFills = !patternFills)}
            aria-pressed={patternFills}
            class="strata-chip"
            title="Toggle pattern fills for color blindness accessibility"
        >
            Pattern fills
        </button>
        <button onclick={resetZoom} class="btn-ghost"> Reset zoom </button>
    </div>

    <!-- Detail strip (updates on hover, shows latest when idle) -->
    {#if activeStrip}
        <div
            class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-4 py-2"
            role="status"
            aria-live="polite"
            aria-label="Chart data for {activeStrip.date}"
            style="font-family: var(--font-mono); font-size: 0.75rem; font-variant-numeric: tabular-nums; letter-spacing: 0.02em;"
        >
            <span
                class="whitespace-nowrap font-medium"
                style="color: var({activeStrip.hovering ? '--color-text' : '--color-text-secondary'});"
            >
                {activeStrip.date}
            </span>

            {#each activeStrip.items as item (item.label)}
                <span class="inline-flex items-center gap-1 whitespace-nowrap text-[var(--color-text-secondary)]">
                    <span
                        class="inline-block h-2 w-2 shrink-0 rounded-full"
                        style="background-color: {item.color};"
                        aria-hidden="true"
                    ></span>
                    <span class="hidden sm:inline">{item.label}:</span>
                    <span class="sm:hidden">{abbreviateLabel(item.label)}:</span>
                    <span class="text-[var(--color-text)]">{formatStripNumber(item.value)}</span>
                    <span class="hidden sm:inline text-[var(--color-text-tertiary)]">({item.pct}%)</span>
                </span>
            {/each}

            <span class="ml-auto whitespace-nowrap font-medium text-[var(--color-text)]">
                Total: {formatStripNumber(activeStrip.total)}
            </span>
        </div>
    {/if}

    <!-- Chart canvas -->
    <div
        class="relative h-64 w-full p-4 sm:h-80 md:h-96 lg:h-[28rem] xl:h-[32rem]"
        role="img"
        aria-label={ariaLabel}
        ontouchend={handleTouchEnd}
    >
        <canvas bind:this={canvasEl}></canvas>
    </div>

    {#if live}
        <div class="border-t border-[var(--color-border)] px-4 py-2">
            <p
                class="text-center text-[var(--color-text-tertiary)]"
                style="font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.02em;"
            >
                Chart updates as data streams in...
            </p>
        </div>
    {/if}
</div>
