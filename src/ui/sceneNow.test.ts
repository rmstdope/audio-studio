import { describe, expect, test } from 'bun:test'
import { audible, clock, muteSoloText, nowWords } from './sceneNow'

const base = {
  state: 'plain',
  muted: false,
  notSoloed: false,
  silent: false,
  gone: false,
  failed: false,
}

describe('nowWords', () => {
  test('says what each row is doing', () => {
    expect(nowWords({ kind: 'playing' }, base)).toBe('Playing')
    expect(nowWords({ kind: 'in', seconds: 1.2 }, base)).toBe('In 2 s')
    expect(nowWords({ kind: 'next', seconds: 8.01 }, base)).toBe('Next in 9 s')
    expect(nowWords({ kind: 'played', at: 2 }, base)).toBe('Played at 0:02')
    expect(nowWords({ kind: 'waits', trigger: 'door-opens' }, base)).toBe('Waits for door-opens')
    expect(nowWords({ kind: 'otherState' }, base)).toBe('Not in plain')
  })
  test('silent, gone and failed rows say so, ahead of the rest', () => {
    expect(nowWords({ kind: 'playing' }, { ...base, silent: true })).toBe('Silent')
    expect(nowWords({ kind: 'playing' }, { ...base, gone: true })).toBe('Not played')
    expect(nowWords({ kind: 'playing' }, { ...base, failed: true })).toBe("Couldn't load the clip")
  })
  test('muted and not soloed rows keep their words with a suffix', () => {
    expect(nowWords({ kind: 'playing' }, { ...base, muted: true })).toBe('Playing, muted')
    expect(nowWords({ kind: 'next', seconds: 9 }, { ...base, notSoloed: true })).toBe(
      'Next in 9 s, not soloed',
    )
    expect(nowWords({ kind: 'next', seconds: 9 }, { ...base, muted: true, notSoloed: true })).toBe(
      'Next in 9 s, muted',
    )
  })
})

describe('mute and solo', () => {
  test('solo wins over mute; with no solo only the muted are silent', () => {
    expect(audible('a', new Set(), new Set())).toBe(true)
    expect(audible('a', new Set(['a']), new Set())).toBe(false)
    expect(audible('a', new Set(['a']), new Set(['a']))).toBe(true)
    expect(audible('b', new Set(), new Set(['a']))).toBe(false)
  })
  test('the play bar counts them', () => {
    expect(muteSoloText(0, 0)).toBeNull()
    expect(muteSoloText(1, 0)).toBe('Muted: 1')
    expect(muteSoloText(0, 2)).toBe('Solo: 2')
    expect(muteSoloText(1, 1)).toBe('Solo: 1 · Muted: 1')
  })
  test('the clock is m:ss', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(14.9)).toBe('0:14')
    expect(clock(75)).toBe('1:15')
  })
})
