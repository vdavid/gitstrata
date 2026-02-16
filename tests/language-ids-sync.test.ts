import { describe, it, expect } from 'vitest'
import { getLanguages } from '$lib/languages'
import { validLanguageIds } from '../shared/language-ids'

describe('language ID sync', () => {
    it('every language from getLanguages() is in validLanguageIds', () => {
        for (const lang of getLanguages()) {
            expect(validLanguageIds.has(lang.id), `"${lang.id}" missing from validLanguageIds`).toBe(true)
        }
    })

    it('every validLanguageIds entry is a getLanguages() ID or "other"', () => {
        const registeredIds = new Set(getLanguages().map((l) => l.id))
        for (const id of validLanguageIds) {
            expect(
                id === 'other' || registeredIds.has(id),
                `"${id}" in validLanguageIds but not in getLanguages()`,
            ).toBe(true)
        }
    })
})
