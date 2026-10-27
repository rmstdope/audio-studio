import { describe, expect, it } from 'bun:test'
import { DEFAULT_TAKE_FADE, fadeEntries, fadeLabel, fadeSaveFailure } from './takeFade'

describe('the take fade', () => {
  it('is 0.2 s until one is chosen', () => {
    expect(DEFAULT_TAKE_FADE).toBe(0.2)
  })

  it('names a length the way the menu does', () => {
    expect([0, 0.1, 0.2, 0.5, 1, 2, 0.3, 1.5].map(fadeLabel)).toEqual([
      'No fade',
      '0.1 s',
      '0.2 s',
      '0.5 s',
      '1 s',
      '2 s',
      '0.3 s',
      '1.5 s',
    ])
  })

  it('lists the six lengths, and a hand-set one in its place by size', () => {
    expect(fadeEntries(0.2).map((e) => e.label)).toEqual([
      'No fade',
      '0.1 s',
      '0.2 s',
      '0.5 s',
      '1 s',
      '2 s',
    ])
    expect(fadeEntries(0.3).map((e) => e.label)).toEqual([
      'No fade',
      '0.1 s',
      '0.2 s',
      '0.3 s',
      '0.5 s',
      '1 s',
      '2 s',
    ])
    expect(fadeEntries(5).map((e) => e.seconds)).toEqual([0, 0.1, 0.2, 0.5, 1, 2, 5])
  })

  it('says why a save failed and what the fade still is', () => {
    expect(fadeSaveFailure('the project file could not be written', 0.2)).toBe(
      'Could not save the fade: the project file could not be written. It is still 0.2 s.',
    )
    expect(fadeSaveFailure('nope', 0)).toBe('Could not save the fade: nope. It is still no fade.')
  })
})
