import type { Chart, ChartType, Plugin } from 'chart.js'

interface AreaLabelsOptions {
    enabled?: boolean
}

declare module 'chart.js' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface PluginOptionsByType<TType extends ChartType> {
        areaLabels: AreaLabelsOptions
    }
}

interface LabelBox {
    cx: number
    cy: number
    width: number
    height: number
    angle: number
}

interface BandPoint {
    x: number
    topY: number
    bottomY: number
    midY: number
    bandHeight: number
}

const minBandHeight = 20
const minFontSize = 9
const maxFontSize = 16
const maxAngleDeg = 25
const maxAngleRad = (maxAngleDeg * Math.PI) / 180
const fontSizeToBandRatio = 0.5

const getCssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Parse a hex color (#rgb or #rrggbb) into [r, g, b] 0-255. */
const parseHex = (hex: string): [number, number, number] | undefined => {
    const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim())
    if (!m) return undefined
    const h = m[1]
    if (h.length === 3) {
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    }
    if (h.length >= 6) {
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }
    return undefined
}

/** Convert RGB (0-255) to HSL (h: 0-360, s: 0-1, l: 0-1). */
const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    if (max === min) return [0, 0, l]
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h: number
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
    return [h * 360, s, l]
}

/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to a CSS hex color. */
const hslToHex = (h: number, s: number, l: number): string => {
    const hue2rgb = (p: number, q: number, t: number): number => {
        const tn = t < 0 ? t + 1 : t > 1 ? t - 1 : t
        if (tn < 1 / 6) return p + (q - p) * 6 * tn
        if (tn < 1 / 2) return q
        if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6
        return p
    }
    if (s === 0) {
        const v = Math.round(l * 255)
        return `#${v.toString(16).padStart(2, '0').repeat(3)}`
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const r = Math.round(hue2rgb(p, q, h / 360 + 1 / 3) * 255)
    const g = Math.round(hue2rgb(p, q, h / 360) * 255)
    const b = Math.round(hue2rgb(p, q, h / 360 - 1 / 3) * 255)
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * Derive a readable label color from the dataset's border color.
 * In dark mode (dark bg), lightens to 70-80%. In light mode (light bg), darkens to 25-35%.
 * Also boosts saturation slightly for vibrancy.
 */
const deriveReadableColor = (borderColor: string, isDark: boolean): string => {
    const rgb = parseHex(borderColor)
    if (!rgb) return borderColor
    const [h, s] = rgbToHsl(...rgb)
    const targetL = isDark ? 0.75 : 0.3
    const boostedS = Math.min(1, s * 1.2)
    return hslToHex(h, boostedS, targetL)
}

/** Extract pixel geometry for a band at each data point. */
const extractBandGeometry = (chart: Chart, datasetIndex: number): BandPoint[] => {
    const meta = chart.getDatasetMeta(datasetIndex)
    if (!meta.visible || meta.data.length === 0) return []

    // Find the previous visible dataset for the bottom edge
    let prevMeta: ReturnType<Chart['getDatasetMeta']> | undefined
    for (let i = datasetIndex - 1; i >= 0; i--) {
        const m = chart.getDatasetMeta(i)
        if (m.visible) {
            prevMeta = m
            break
        }
    }

    const yScale = chart.scales[meta.yAxisID ?? 'y']
    const baseY = yScale.getPixelForValue(yScale.min ?? 0)

    const points: BandPoint[] = []
    for (let j = 0; j < meta.data.length; j++) {
        const point = meta.data[j]
        const topY = point.y
        const bottomY = prevMeta?.data[j]?.y ?? baseY
        const bandHeight = bottomY - topY
        points.push({
            x: point.x,
            topY,
            bottomY,
            midY: (topY + bottomY) / 2,
            bandHeight,
        })
    }
    return points
}

/**
 * Find the x-position where the band is widest over a window approximating text width.
 * Rejects positions where the label would overflow the chart area (with padding).
 */
const findOptimalPosition = (
    points: BandPoint[],
    textWidth: number,
    chartArea: { left: number; right: number },
): { index: number; minHeight: number } | undefined => {
    if (points.length < 2) return undefined

    const padding = 12
    const halfText = textWidth / 2
    const minX = chartArea.left + halfText + padding
    const maxX = chartArea.right - halfText - padding

    // Estimate how many data points span the text width
    const avgGap = (points[points.length - 1].x - points[0].x) / (points.length - 1)
    const windowSize = Math.max(1, Math.ceil(textWidth / avgGap))

    let bestIndex = -1
    let bestMinH = -1

    for (let i = 0; i <= points.length - windowSize; i++) {
        const centerIndex = i + Math.floor(windowSize / 2)
        const centerX = points[centerIndex].x

        // Skip positions where the label would overflow the chart area
        if (centerX < minX || centerX > maxX) continue

        // Minimum band height in the window
        let minH = Infinity
        for (let w = 0; w < windowSize && i + w < points.length; w++) {
            minH = Math.min(minH, points[i + w].bandHeight)
        }
        if (minH < minBandHeight) continue

        if (minH > bestMinH) {
            bestMinH = minH
            bestIndex = centerIndex
        }
    }

    if (bestIndex < 0) return undefined
    return { index: bestIndex, minHeight: points[bestIndex].bandHeight }
}

/** Compute the angle of the band midline slope at a given index. */
const computeAngle = (points: BandPoint[], index: number): number => {
    const prev = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next.x - prev.x
    const dy = next.midY - prev.midY
    if (Math.abs(dx) < 1) return 0
    const angle = Math.atan2(dy, dx)
    return Math.max(-maxAngleRad, Math.min(maxAngleRad, angle))
}

/** Check if a candidate box overlaps any existing placed label. */
const checkCollision = (candidate: LabelBox, placed: LabelBox[]): boolean => {
    const halfW = candidate.width / 2 + 4
    const halfH = candidate.height / 2 + 2
    for (const box of placed) {
        const bHalfW = box.width / 2 + 4
        const bHalfH = box.height / 2 + 2
        if (Math.abs(candidate.cx - box.cx) < halfW + bHalfW && Math.abs(candidate.cy - box.cy) < halfH + bHalfH) {
            return true
        }
    }
    return false
}

/** Render a single label with halo effect. */
const drawLabel = (
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    cy: number,
    angle: number,
    fontSize: number,
    textColor: string,
    haloColor: string,
): void => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)

    const fontFamily = getCssVar('--font-sans').split(',')[0].replace(/'/g, '')
    ctx.font = `600 ${fontSize}px ${fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Halo: stroke with semi-transparent background for contrast
    ctx.strokeStyle = haloColor
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.globalAlpha = 0.85
    ctx.strokeText(text, 0, 0)

    // Fill with readable derived color
    ctx.globalAlpha = 1
    ctx.fillStyle = textColor
    ctx.fillText(text, 0, 0)

    ctx.restore()
}

export const areaLabelsPlugin: Plugin<'line', AreaLabelsOptions> = {
    id: 'areaLabels',

    afterDatasetsDraw(chart: Chart<'line'>, _args, options) {
        if (options?.enabled === false) return

        const ctx = chart.ctx
        const chartArea = chart.chartArea
        if (!ctx || !chartArea) return

        // Detect dark/light mode from background color luminance
        const bgColor = getCssVar('--color-bg')
        const bgRgb = parseHex(bgColor)
        const isDark = bgRgb ? (bgRgb[0] * 299 + bgRgb[1] * 587 + bgRgb[2] * 114) / 1000 < 128 : false

        const placed: LabelBox[] = []

        for (let i = 0; i < chart.data.datasets.length; i++) {
            const meta = chart.getDatasetMeta(i)
            if (!meta.visible) continue

            const dataset = chart.data.datasets[i]
            const label = dataset.label
            if (!label) continue

            const points = extractBandGeometry(chart, i)
            if (points.length === 0) continue

            const maxH = Math.max(...points.map((p) => p.bandHeight))
            if (maxH < minBandHeight) continue

            const fontSize = Math.max(minFontSize, Math.min(maxFontSize, Math.round(maxH * fontSizeToBandRatio)))

            const fontFamily = getCssVar('--font-sans').split(',')[0].replace(/'/g, '')
            ctx.font = `600 ${fontSize}px ${fontFamily}`
            const textWidth = ctx.measureText(label).width

            const optimal = findOptimalPosition(points, textWidth, chartArea)
            if (!optimal) continue

            const p = points[optimal.index]

            if (textWidth > (chartArea.right - chartArea.left) * 0.8) continue
            if (p.bandHeight < fontSize * 1.2) continue

            const angle = computeAngle(points, optimal.index)

            const candidate: LabelBox = {
                cx: p.x,
                cy: p.midY,
                width: textWidth,
                height: fontSize,
                angle,
            }

            if (checkCollision(candidate, placed)) continue

            const rawBorderColor =
                typeof dataset.borderColor === 'string' ? dataset.borderColor : getCssVar('--color-text')
            const textColor = deriveReadableColor(rawBorderColor, isDark)

            drawLabel(ctx, label, p.x, p.midY, angle, fontSize, textColor, bgColor)
            placed.push(candidate)
        }
    },
}
