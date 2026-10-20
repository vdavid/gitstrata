// Cheap checks for shared-cache writes. The Worker runs on the free plan (10 ms CPU per request), so a PUT never
// parses its body: it trusts the holder of a write key and checks only these headers.

const repoUrlPattern = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+$/
const commitPattern = /^[0-9a-f]{40}$/

export const isValidRepoUrl = (repoUrl: string): boolean => repoUrlPattern.test(repoUrl)

export const isValidCommit = (commit: string): boolean => commitPattern.test(commit)

export const sha256Hex = async (input: string): Promise<string> => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Parses the `WRITE_KEY_HASHES` secret: comma-separated lowercase SHA-256 hex digests. */
export const parseKeyHashes = (secret: string | undefined): string[] =>
    (secret ?? '')
        .split(',')
        .map((hash) => hash.trim().toLowerCase())
        .filter((hash) => /^[0-9a-f]{64}$/.test(hash))

const constantTimeEqual = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

/** Checks a presented key against the allowed hashes. Compares against every hash so timing doesn't reveal which. */
export const isValidWriteKey = async (key: string, keyHashes: string[]): Promise<boolean> => {
    if (!key) return false
    const presented = await sha256Hex(key)
    return keyHashes.reduce((found, hash) => constantTimeEqual(presented, hash) || found, false)
}

/** Reads a request body, giving up (returns null) as soon as it grows past `maxBytes`. */
export const readBodyWithLimit = async (
    body: ReadableStream<Uint8Array> | null,
    maxBytes: number,
): Promise<Uint8Array | null> => {
    if (!body) return new Uint8Array(0)
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
            void reader.cancel()
            return null
        }
        chunks.push(value)
    }
    const result = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
    }
    return result
}
