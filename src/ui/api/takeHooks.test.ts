import { afterEach, describe, expect, it } from 'bun:test'
import { sendTake, takeActions, takeQueryKeys } from './takeHooks'

describe('takeActions', () => {
  const actions = takeActions()

  it('asks for the request of each action once, for any medium', () => {
    expect(actions.make.request({ count: 2 })).toEqual({
      method: 'POST',
      path: '/takes',
      body: { count: 2 },
    })
    expect(actions.stop.request()).toEqual({ method: 'POST', path: '/stop' })
    expect(actions.choose.request('f 1.wav')).toEqual({
      method: 'POST',
      path: '/choose',
      body: { file: 'f 1.wav' },
    })
    expect(actions.trim.request({ file: 'f', undo: true })).toEqual({
      method: 'POST',
      path: '/trim',
      body: { file: 'f', undo: true },
    })
    expect(actions.drop.request('f 1.wav')).toEqual({
      method: 'DELETE',
      path: '/takes/f%201.wav',
    })
    expect(actions.unchoose.request()).toEqual({ method: 'POST', path: '/unchoose' })
    expect(actions.accept.request()).toEqual({ method: 'POST', path: '/accept' })
  })

  it('saves fades with PUT and removes them with DELETE', () => {
    const fades = { in: 1, out: 2, shape: 'smooth' as const }
    expect(actions.fades.request({ file: 'f', fades })).toEqual({
      method: 'PUT',
      path: '/takes/f/fades',
      body: fades,
    })
    expect(actions.fades.request({ file: 'f', fades: null })).toEqual({
      method: 'DELETE',
      path: '/takes/f/fades',
    })
  })

  it('tolerates a refusal (409) except when stopping', () => {
    expect(actions.make.tolerated).toEqual([409])
    expect(actions.stop.tolerated).toEqual([])
  })
})

describe('sendTake', () => {
  const actions = takeActions()
  const original = globalThis.fetch
  const seen: { url: string; init: RequestInit }[] = []
  const answer = (status: number) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return Response.json({ ok: status < 400 }, { status })
    }) as unknown as typeof fetch
  }
  afterEach(() => {
    globalThis.fetch = original
    seen.length = 0
  })

  it('sends the request to the medium’s address with a JSON body', async () => {
    answer(200)
    await sendTake('/api/things/a%20b', actions.choose, 'f.wav')
    expect(seen[0]?.url).toBe('/api/things/a%20b/choose')
    expect(seen[0]?.init.method).toBe('POST')
    expect(seen[0]?.init.body).toBe('{"file":"f.wav"}')
  })

  it('returns a refusal (409) but throws what it was doing on another failure', async () => {
    answer(409)
    expect(await sendTake('/b', actions.make, { count: 1 })).toEqual({ ok: false })
    answer(500)
    await expect(sendTake('/b', actions.make, { count: 1 })).rejects.toThrow(
      'asking for takes answered 500',
    )
    answer(409)
    await expect(sendTake('/b', actions.stop, undefined)).rejects.toThrow(
      'stopping the takes answered 409',
    )
  })

  it('makes stale the project, the takes and what is being made, per medium', () => {
    const medium = { base: (id: string) => id, takesKey: 'music-takes', makingKey: 'music-making' }
    expect(takeQueryKeys(medium, 't1')).toEqual([
      ['project'],
      ['music-takes', 't1'],
      ['music-making'],
    ])
  })
})
