// Reactive singleton wrapping the GitHub token storage. Components read `githubTokenState.current`
// to update live; the page reads it to pass the token into the worker.

import { browser } from '$app/environment'
import {
    readStoredToken,
    writeStoredToken,
    clearStoredToken,
    verifyGithubToken,
    makeTokenEntry,
    type StoredGithubToken,
} from './github-token'

// Only read storage in the browser; during SSR/prerender there is no token to show.
let current = $state<StoredGithubToken | undefined>(browser ? readStoredToken() : undefined)

export const githubTokenState = {
    get current(): StoredGithubToken | undefined {
        return current
    },
}

/** Verify the token against GitHub, then store it locally. Throws on a bad token. */
export const saveGithubToken = async (token: string): Promise<void> => {
    const trimmed = token.trim()
    const account = await verifyGithubToken(trimmed)
    const entry = makeTokenEntry(trimmed, account.login)
    writeStoredToken(entry)
    current = entry
}

export const deleteGithubToken = (): void => {
    clearStoredToken()
    current = undefined
}
