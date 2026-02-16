import { describe, it, expect } from 'vitest'
import { countLines } from '../src/lib/git/count'

describe('countLines', () => {
    it('counts lines ending with newline', () => {
        expect(countLines('a\nb\nc\n')).toBe(3)
    })

    it('counts lines not ending with newline', () => {
        expect(countLines('a\nb\nc')).toBe(3)
    })

    it('returns 0 for empty content', () => {
        expect(countLines('')).toBe(0)
    })

    it('counts single line without newline', () => {
        expect(countLines('hello')).toBe(1)
    })

    it('counts single line with newline', () => {
        expect(countLines('hello\n')).toBe(1)
    })

    it('handles multiple blank lines', () => {
        expect(countLines('\n\n\n')).toBe(3)
    })

    it('matches Go reference: count newlines, add 1 if no trailing newline', () => {
        // This matches: strings.Count(content, "\n") + (no trailing \n ? 1 : 0)
        expect(countLines('line1\nline2\n')).toBe(2)
        expect(countLines('line1\nline2')).toBe(2)
    })
})
