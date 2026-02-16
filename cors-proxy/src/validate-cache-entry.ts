import { isValidLanguageId } from '../../shared/language-ids'

const repoUrlPattern = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+$/
const commitPattern = /^[0-9a-f]{40}$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const maxDays = 20_000

/**
 * Validates a parsed cache entry payload.
 * Returns an error message string if invalid, or null if valid.
 */
export const validateCacheEntry = (data: unknown): string | null => {
    if (typeof data !== 'object' || data === null) return 'Payload must be a non-null object.'
    const obj = data as Record<string, unknown>

    // Shape: top-level fields
    if (obj.version !== 1) return 'version must be 1.'
    if (typeof obj.repoUrl !== 'string') return 'repoUrl must be a string.'
    if (typeof obj.headCommit !== 'string') return 'headCommit must be a string.'
    if (typeof obj.updatedAt !== 'string') return 'updatedAt must be a string.'
    if (typeof obj.result !== 'object' || obj.result === null) return 'result must be an object.'

    // repoUrl format
    if (!repoUrlPattern.test(obj.repoUrl)) {
        return 'repoUrl must match https://(github.com|gitlab.com|bitbucket.org)/<owner>/<repo>.'
    }

    // headCommit format
    if (!commitPattern.test(obj.headCommit)) {
        return 'headCommit must be a 40-character lowercase hex string.'
    }

    const result = obj.result as Record<string, unknown>

    // result.days
    if (!Array.isArray(result.days)) return 'result.days must be an array.'
    if (result.days.length > maxDays) return `result.days exceeds maximum of ${maxDays} entries.`

    // result.detectedLanguages
    if (!Array.isArray(result.detectedLanguages)) return 'result.detectedLanguages must be an array.'
    for (const langId of result.detectedLanguages) {
        if (typeof langId !== 'string') return 'Each detectedLanguages entry must be a string.'
        if (!isValidLanguageId(langId)) return `Invalid language ID in detectedLanguages: "${langId}".`
    }

    // Validate each day
    for (let i = 0; i < result.days.length; i++) {
        const day = result.days[i] as Record<string, unknown>
        if (typeof day !== 'object' || day === null) return `days[${i}] must be an object.`

        // date format
        if (typeof day.date !== 'string' || !datePattern.test(day.date)) {
            return `days[${i}].date must match YYYY-MM-DD.`
        }

        // total
        if (!isNonNegativeInteger(day.total)) return `days[${i}].total must be a non-negative integer.`

        // comments
        if (!Array.isArray(day.comments)) return `days[${i}].comments must be an array.`
        for (const comment of day.comments) {
            if (typeof comment !== 'string') return `days[${i}].comments must contain only strings.`
        }

        // languages
        if (typeof day.languages !== 'object' || day.languages === null) {
            return `days[${i}].languages must be an object.`
        }
        const languages = day.languages as Record<string, unknown>
        for (const [langId, counts] of Object.entries(languages)) {
            if (!isValidLanguageId(langId)) return `Invalid language ID in days[${i}].languages: "${langId}".`
            if (typeof counts !== 'object' || counts === null) {
                return `days[${i}].languages["${langId}"] must be an object.`
            }
            const lc = counts as Record<string, unknown>
            if (!isNonNegativeInteger(lc.total)) {
                return `days[${i}].languages["${langId}"].total must be a non-negative integer.`
            }
            if (lc.prod !== undefined) {
                if (!isNonNegativeInteger(lc.prod)) {
                    return `days[${i}].languages["${langId}"].prod must be a non-negative integer.`
                }
                if (lc.test !== undefined) {
                    if (!isNonNegativeInteger(lc.test)) {
                        return `days[${i}].languages["${langId}"].test must be a non-negative integer.`
                    }
                    if ((lc.prod as number) + (lc.test as number) !== (lc.total as number)) {
                        return `days[${i}].languages["${langId}"]: prod + test must equal total.`
                    }
                }
            }
        }
    }

    return null
}

const isNonNegativeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0
