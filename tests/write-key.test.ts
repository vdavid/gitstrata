import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readWriteKey, writeWriteKey, clearWriteKey, takeWriteKeyFromHash } from '../src/lib/write-key'

const makeLocalStorage = () => {
    const store = new Map<string, string>()
    return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
    }
}

describe('write-key storage', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', makeLocalStorage())
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('round-trips a stored key', () => {
        writeWriteKey('abc123')
        expect(readWriteKey()).toBe('abc123')
    })

    it('returns undefined when nothing is stored', () => {
        expect(readWriteKey()).toBeUndefined()
    })

    it('clears a stored key', () => {
        writeWriteKey('abc123')
        clearWriteKey()
        expect(readWriteKey()).toBeUndefined()
    })

    it('survives storage that throws', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked')
            },
            setItem: () => {
                throw new Error('blocked')
            },
            removeItem: () => {
                throw new Error('blocked')
            },
        })
        expect(() => writeWriteKey('k')).not.toThrow()
        expect(readWriteKey()).toBeUndefined()
        expect(() => clearWriteKey()).not.toThrow()
    })

    it('reads undefined when localStorage is missing', () => {
        vi.stubGlobal('localStorage', undefined)
        expect(readWriteKey()).toBeUndefined()
    })
})

describe('takeWriteKeyFromHash', () => {
    it('extracts the key and leaves an empty hash', () => {
        expect(takeWriteKeyFromHash('#write-key=abc123')).toEqual({ key: 'abc123', remainingHash: '' })
    })

    it('keeps other hash params', () => {
        expect(takeWriteKeyFromHash('#foo=1&write-key=abc&bar=2')).toEqual({
            key: 'abc',
            remainingHash: '#foo=1&bar=2',
        })
    })

    it('returns no key when absent or empty', () => {
        expect(takeWriteKeyFromHash('')).toEqual({ key: undefined, remainingHash: '' })
        expect(takeWriteKeyFromHash('#main-content')).toEqual({ key: undefined, remainingHash: '#main-content' })
        expect(takeWriteKeyFromHash('#write-key=')).toEqual({ key: undefined, remainingHash: '' })
    })
})
