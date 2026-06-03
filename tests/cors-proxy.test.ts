import { describe, it, expect } from 'vitest'
import { isSelfHostedProxy, publicProxyUrl } from '../src/lib/cors-proxy'

describe('isSelfHostedProxy', () => {
    it('treats the public default as not self-hosted', () => {
        expect(isSelfHostedProxy(publicProxyUrl)).toBe(false)
        expect(isSelfHostedProxy(publicProxyUrl + '/')).toBe(false)
    })

    it('treats any other proxy as self-hosted', () => {
        expect(isSelfHostedProxy('https://proxy.gitstrata.com')).toBe(true)
        expect(isSelfHostedProxy('http://localhost:8787')).toBe(true)
    })
})
