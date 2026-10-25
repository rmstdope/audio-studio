import { describe, expect, it } from 'bun:test'
import { speedDraft } from './speedDraft'

describe('speedDraft', () => {
  it('reads a speed, and says whether it changed', () => {
    expect(speedDraft('0.9', null)).toEqual({ ok: true, speed: 0.9, changed: true })
    expect(speedDraft(' 1.2 ', 1.2)).toEqual({ ok: true, speed: 1.2, changed: false })
  })

  it('takes an empty speed as the project’s', () => {
    expect(speedDraft('', 0.9)).toEqual({ ok: true, speed: null, changed: true })
    expect(speedDraft('  ', null)).toEqual({ ok: true, speed: null, changed: false })
  })

  it('refuses what Fish cannot speak at', () => {
    for (const typed of ['0.4', '2.1', 'fast', 'NaN']) {
      expect(speedDraft(typed, null)).toMatchObject({ ok: false })
    }
  })
})
