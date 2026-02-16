import type { Chart, ChartType, Plugin } from 'chart.js'

interface CrosshairOptions {
    enabled?: boolean
}

declare module 'chart.js' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface PluginOptionsByType<TType extends ChartType> {
        crosshair: CrosshairOptions
    }
}

const getCssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Chart.js plugin that draws a vertical crosshair line at the hovered x position. */
export const crosshairPlugin: Plugin<'line', CrosshairOptions> = {
    id: 'crosshair',

    afterDatasetsDraw(chart: Chart<'line'>, _args, options) {
        if (options?.enabled === false) return
        const xPixel = (chart as unknown as Record<string, unknown>).__crosshairX as number | undefined
        if (xPixel == null) return

        const ctx = chart.ctx
        const { top, bottom } = chart.chartArea

        ctx.save()
        ctx.beginPath()
        ctx.moveTo(xPixel, top)
        ctx.lineTo(xPixel, bottom)
        ctx.lineWidth = 1
        ctx.strokeStyle = getCssVar('--color-foreground-tertiary') + '66'
        ctx.setLineDash([4, 3])
        ctx.stroke()
        ctx.restore()
    },

    afterEvent(chart: Chart<'line'>, args, options) {
        if (options?.enabled === false) return
        const event = args.event
        const rec = chart as unknown as Record<string, unknown>

        if (event.type === 'mouseout') {
            rec.__crosshairX = undefined
            chart.draw()
            return
        }

        if (event.type === 'mousemove' && event.x != null) {
            const { left, right } = chart.chartArea
            rec.__crosshairX = event.x >= left && event.x <= right ? event.x : undefined
        }
    },
}
