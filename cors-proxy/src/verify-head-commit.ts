const fetchTimeoutMs = 5_000

/**
 * Verifies that `headCommit` exists in the git host's advertised refs.
 * Fetches `/info/refs?service=git-upload-pack` directly from the origin
 * and checks that the 40-char hex OID appears in the response body.
 *
 * Fails closed: network errors, timeouts, and non-200 responses all reject.
 */
export const verifyHeadCommit = async (repoUrl: string, headCommit: string): Promise<string | null> => {
    const base = repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`
    const url = `${base}/info/refs?service=git-upload-pack`

    let response: Response
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(fetchTimeoutMs) })
    } catch {
        return 'Failed to verify headCommit: could not reach the git host.'
    }

    if (!response.ok) {
        return `Failed to verify headCommit: git host returned ${response.status}.`
    }

    let body: string
    try {
        body = await response.text()
    } catch {
        return 'Failed to verify headCommit: error reading response from git host.'
    }

    if (!body.includes(headCommit)) {
        return 'headCommit not found in the repository refs.'
    }

    return null
}
