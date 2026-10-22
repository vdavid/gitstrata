// Reactive singleton wrapping the shared-cache write key. Components read `writeKeyState.current` to update live.

import { browser } from '$app/env'
import { readWriteKey, writeWriteKey, clearWriteKey, takeWriteKeyFromHash } from './write-key'
import { trackEvent } from './analytics'

let current = $state<string | undefined>(browser ? readWriteKey() : undefined)

export const writeKeyState = {
    get current(): string | undefined {
        return current
    },
}

/** Saves a key handed off via `#write-key=KEY`, then strips it from the URL so it doesn't linger in history. */
export const adoptWriteKeyFromUrl = (): void => {
    const { key, remainingHash } = takeWriteKeyFromHash(location.hash)
    if (key === undefined && remainingHash === location.hash) return
    if (key) {
        writeWriteKey(key)
        current = key
        trackEvent('write-key-adopted')
    }
    history.replaceState(history.state, '', `${location.pathname}${location.search}${remainingHash}`)
}

export const deleteWriteKey = (): void => {
    clearWriteKey()
    current = undefined
}
