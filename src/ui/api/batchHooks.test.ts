import { afterEach, describe, expect, it } from 'bun:test'
import { makeAllActions } from './batchHooks'
import { sendTake } from './takeHooks'

describe('makeAllActions', () => {
  it('asks for Make all and Stop all at the medium’s address, with Stop all named as the medium names it', () => {
    const effects = makeAllActions('stop-all', [409])
    expect(effects.make.request({ ids: ['a'] })).toEqual({
      method: 'POST',
      path: '/make-all',
      body: { ids: ['a'] },
    })
    expect(effects.stop.request()).toEqual({ method: 'POST', path: '/stop-all' })
    expect(makeAllActions('stop', []).stop.request().path).toBe('/stop')
  })

  it('tolerates a refusal only where the medium does', () => {
    expect(makeAllActions('stop', [409]).make.tolerated).toEqual([409])
    expect(makeAllActions('stop', [409]).stop.tolerated).toEqual([409])
    expect(makeAllActions('stop', []).make.tolerated).toEqual([])
  })

  describe('sent', () => {
    const original = globalThis.fetch
    const seen: { url: string; init: RequestInit }[] = []
    afterEach(() => {
      globalThis.fetch = original
      seen.length = 0
    })

    it('sends Make all without a body when it has none, and throws what it was doing on a failure', async () => {
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        seen.push({ url, init })
        return Response.json({ ok: false }, { status: 409 })
      }) as unknown as typeof fetch
      const actions = makeAllActions('stop', [])
      await expect(sendTake('/api/music/lists/a', actions.make, undefined)).rejects.toThrow(
        'asking for takes answered 409',
      )
      expect(seen[0]?.url).toBe('/api/music/lists/a/make-all')
      expect(seen[0]?.init.body).toBeUndefined()
    })
  })
})
