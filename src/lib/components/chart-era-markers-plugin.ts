import type { Chart, ChartType, Plugin } from 'chart.js'

interface EraMarkersOptions {
    enabled?: boolean
    firstDate?: string // YYYY-MM-DD — repo's first date
    lastDate?: string // YYYY-MM-DD — repo's last date
}

declare module 'chart.js' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface PluginOptionsByType<TType extends ChartType> {
        eraMarkers: EraMarkersOptions
    }
}

const eraMarkers = [
    { date: '2022-06-21', label: "Copilot '22", ariaLabel: 'Copilot general availability, June 2022' },
    { date: '2025-01-01', label: "Agentic '25", ariaLabel: 'Agentic era, January 2025' },
    { date: '2025-11-24', label: "Opus '25", ariaLabel: 'Opus 4.5, November 2025' },
]

const getCssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export const eraMarkersPlugin: Plugin<'line', EraMarkersOptions> = {
    id: 'eraMarkers',

    afterDatasetsDraw(chart: Chart<'line'>, _args, options) {
        if (options?.enabled === false) return

        const firstDate = options?.firstDate
        const lastDate = options?.lastDate
        if (!firstDate || !lastDate) return

        const firstTime = new Date(firstDate).getTime()
        const lastTime = new Date(lastDate).getTime()

        const ctx = chart.ctx
        const { top, left, right } = chart.chartArea
        if (!ctx) return

        const color = getCssVar('--color-foreground-tertiary')
        const fontFamily = getCssVar('--font-mono').split(',')[0].replace(/'/g, '')

        for (const marker of eraMarkers) {
            const markerTime = new Date(marker.date).getTime()
            if (markerTime < firstTime || markerTime > lastTime) continue

            const xPixel = chart.scales.x.getPixelForValue(markerTime)

            // Skip if outside the visible chart area
            if (xPixel < left || xPixel > right) continue

            // Draw vertical dashed line
            ctx.save()
            ctx.beginPath()
            ctx.moveTo(xPixel, top)
            ctx.lineTo(xPixel, chart.chartArea.bottom)
            ctx.lineWidth = 1
            ctx.strokeStyle = color + '40'
            ctx.setLineDash([6, 4])
            ctx.stroke()
            ctx.restore()

            // Draw label at the top of the chart area
            ctx.save()
            ctx.font = `10px ${fontFamily}`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillStyle = color
            ctx.fillText(marker.label, xPixel, top - 4)
            ctx.restore()
        }
    },
}
