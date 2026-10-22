/**
 * Origin allowlist for `ALLOWED_ORIGINS`: comma-separated entries, each either an exact origin
 * (`https://gitstrata.com`) or a one-label subdomain wildcard (`https://*.git-strata.pages.dev`).
 * Matching is plain string comparison (no regex built from config), so config can't inject patterns.
 */
type OriginRule = { exact: string } | { prefix: string; suffix: string }

// One DNS label: what a wildcard `*` may stand for. Cloudflare Pages preview hashes and branch aliases fit this.
const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function parseRule(entry: string): OriginRule | null {
    if (!entry.includes('*')) return { exact: entry }
    // The only wildcard form: `<scheme>://*.<host>`, with exactly one `*`.
    const match = entry.match(/^([a-z][a-z0-9+.-]*:\/\/)\*(\.[^*]+)$/)
    const [, prefix, suffix] = match ?? []
    return prefix && suffix ? { prefix, suffix } : null
}

/** Returns null when unset or empty, which means "allow any origin" (local dev). */
export function parseAllowedOrigins(value: string | undefined): OriginRule[] | null {
    const entries = (value ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    if (entries.length === 0) return null
    return entries.map(parseRule).filter((rule): rule is OriginRule => rule !== null)
}

export function isOriginAllowed(origin: string, rules: OriginRule[]): boolean {
    return rules.some((rule) => {
        if ('exact' in rule) return origin === rule.exact
        if (!origin.startsWith(rule.prefix) || !origin.endsWith(rule.suffix)) return false
        const label = origin.slice(rule.prefix.length, origin.length - rule.suffix.length)
        return dnsLabelPattern.test(label)
    })
}
