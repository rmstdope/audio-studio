import { describe, expect, it } from 'bun:test'
import { takeActions } from './takeHooks'

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
