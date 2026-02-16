interface ParsedRepo {
    url: string
    host: string
    owner: string
    repo: string
}

const supportedHosts = ['github.com', 'gitlab.com', 'bitbucket.org']

/**
 * Parse and normalize a repo URL.
 * Accepts: full HTTPS URLs (GitHub/GitLab/Bitbucket), with/without .git,
 * and owner/repo shorthand (assumes GitHub).
 */
export const parseRepoUrl = (input: string): ParsedRepo => {
    const trimmed = input.trim()
    if (!trimmed) {
        throw new Error('Repository URL is empty')
    }

    // owner/repo shorthand (no dots, no slashes except one)
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
        const [owner, repo] = trimmed.split('/')
        return {
            url: `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`,
            host: 'github.com',
            owner: owner.toLowerCase(),
            repo: repo.toLowerCase(),
        }
    }

    let url: URL
    try {
        url = new URL(trimmed)
    } catch {
        throw new Error(`Invalid repository URL: ${trimmed}`)
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`Unsupported protocol: ${url.protocol}`)
    }

    const host = url.hostname.toLowerCase()
    if (!supportedHosts.includes(host)) {
        throw new Error(`Unsupported host: ${host}. Supported: ${supportedHosts.join(', ')}`)
    }

    // Strip .git suffix and normalize path
    let path = url.pathname.replace(/\.git$/, '').replace(/\/+$/, '')
    // Remove leading slash
    path = path.replace(/^\//, '')

    const segments = path.split('/').filter(Boolean)
    if (segments.length < 2) {
        throw new Error('URL must contain owner and repository name')
    }

    const owner = segments[0].toLowerCase()
    const repo = segments[1].toLowerCase()

    return {
        url: `https://${host}/${owner}/${repo}`,
        host,
        owner,
        repo,
    }
}

export const repoToDir = (parsed: ParsedRepo): string => {
    return `/${parsed.host}/${parsed.owner}/${parsed.repo}`
}
