// GitHub personal access token storage and verification.
//
// The token is stored only in this browser's localStorage — never on a server. It is sent to
// GitHub (through the CORS proxy) solely to authenticate clones of the user's own private repos.
// The reactive wrapper lives in `github-token.svelte.ts`; this module holds the pure, testable logic.

export interface StoredGithubToken {
    token: string
    account: string // GitHub login, e.g. "octocat"
    addedAt: string // ISO 8601
}

const storageKey = 'gitstrata-github-token'

// During SSR/prerender `localStorage` may be undefined, or a stub without methods — guard both.
const getStorage = (): Storage | null => {
    try {
        if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null
        return localStorage
    } catch {
        return null
    }
}

export const readStoredToken = (): StoredGithubToken | undefined => {
    const storage = getStorage()
    if (!storage) return undefined
    const raw = storage.getItem(storageKey)
    if (!raw) return undefined
    try {
        const parsed = JSON.parse(raw) as Partial<StoredGithubToken>
        if (
            typeof parsed.token === 'string' &&
            typeof parsed.account === 'string' &&
            typeof parsed.addedAt === 'string'
        ) {
            return { token: parsed.token, account: parsed.account, addedAt: parsed.addedAt }
        }
    } catch {
        // Corrupt entry — treat as absent.
    }
    return undefined
}

export const makeTokenEntry = (token: string, account: string): StoredGithubToken => ({
    token,
    account,
    addedAt: new Date().toISOString(),
})

export const writeStoredToken = (entry: StoredGithubToken): void => {
    getStorage()?.setItem(storageKey, JSON.stringify(entry))
}

export const clearStoredToken = (): void => {
    getStorage()?.removeItem(storageKey)
}

const tokenPrefixes = ['github_pat_', 'ghp_', 'gho_', 'ghs_', 'ghu_', 'ghr_']

/** Mask a token for display, e.g. "github_pat_…a1b2". Never reveals the full secret. */
export const maskToken = (token: string): string => {
    const prefix = tokenPrefixes.find((p) => token.startsWith(p)) ?? ''
    return `${prefix}…${token.slice(-4)}`
}

interface GithubAccount {
    login: string
}

/** Confirm a token works by reading the authenticated user. Hits api.github.com directly
 *  (CORS-enabled, no proxy). Throws a friendly message on failure. */
export const verifyGithubToken = async (token: string): Promise<GithubAccount> => {
    let res: Response
    try {
        res = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        })
    } catch {
        throw new Error("Couldn't reach GitHub to verify the token. Check your connection and try again.")
    }
    if (res.status === 401) {
        throw new Error("That token didn't work. Check you copied it fully and it hasn't expired.")
    }
    if (!res.ok) {
        throw new Error(`Couldn't verify the token — GitHub returned ${res.status}. Try again in a moment.`)
    }
    const data = (await res.json()) as { login?: string }
    if (!data.login) {
        throw new Error("Couldn't read the account for this token.")
    }
    return { login: data.login }
}
