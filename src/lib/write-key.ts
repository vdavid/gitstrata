// Personal write key for the shared results cache ("trusted device" sharing).
//
// The owner's devices and a few friends hold a key; results they analyze get uploaded so everyone else can read them.
// The key lives only in this browser's localStorage and is only ever sent to the shared cache. It arrives through a
// handoff link (`https://gitstrata.com/#write-key=KEY`), which the layout consumes and strips from the URL.
// The reactive wrapper lives in `write-key.svelte.ts`; this module holds the pure, testable logic.

const storageKey = 'gitstrata-write-key'
const hashParam = 'write-key'

// During SSR/prerender `localStorage` may be undefined or a stub, and private modes can throw: guard all three.
const getStorage = (): Storage | null => {
    try {
        if (typeof localStorage === 'undefined' || typeof localStorage?.getItem !== 'function') return null
        return localStorage
    } catch {
        return null
    }
}

export const readWriteKey = (): string | undefined => {
    try {
        return getStorage()?.getItem(storageKey) || undefined
    } catch {
        return undefined
    }
}

export const writeWriteKey = (key: string): void => {
    try {
        getStorage()?.setItem(storageKey, key)
    } catch {
        // Storage blocked: the key just won't persist.
    }
}

export const clearWriteKey = (): void => {
    try {
        getStorage()?.removeItem(storageKey)
    } catch {
        // Storage blocked: nothing to clear.
    }
}

/** Pulls `write-key=<value>` out of a location hash, returning the key and the hash without it. */
export const takeWriteKeyFromHash = (hash: string): { key: string | undefined; remainingHash: string } => {
    const params = hash.replace(/^#/, '').split('&').filter(Boolean)
    const match = params.find((p) => p.startsWith(`${hashParam}=`))
    if (match === undefined) return { key: undefined, remainingHash: hash }
    const rest = params.filter((p) => p !== match)
    const key = decodeURIComponent(match.slice(hashParam.length + 1)).trim()
    return { key: key || undefined, remainingHash: rest.length ? `#${rest.join('&')}` : '' }
}
