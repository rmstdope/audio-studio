import { describe, expect, it } from 'bun:test'
import {
  centsUp,
  clock,
  compact,
  aboutDollars,
  dollars,
  longTitle,
  plural,
  separatorBefore,
  shortTitle,
  tintFor,
  voiceLabel,
} from './format'

describe('titles', () => {
  it('splits a title at its colon', () => {
    expect(shortTitle('Act I: The Call to Adventure')).toBe('Act I')
    expect(longTitle('Act I: The Call to Adventure')).toBe('The Call to Adventure')
  })

  it('uses the whole title when there is no colon', () => {
    expect(shortTitle('Act II')).toBe('Act II')
    expect(longTitle('Act II')).toBe('Act II')
  })
})

describe('voiceLabel', () => {
  it('prefers the voice name, then a short id', () => {
    expect(voiceLabel({ voice: 'abcdef123456', voiceName: 'Gentle Granny' })).toBe('Gentle Granny')
    expect(voiceLabel({ voice: 'abcdef123456', voiceName: null })).toBe('voice abcdef12…')
    expect(voiceLabel({ voice: null, voiceName: null })).toBe('No voice yet')
  })
})

describe('separatorBefore', () => {
  it('parts a list with commas, and "and" before the last', () => {
    const join = (names: string[]) =>
      names.map((n, i) => separatorBefore(i, names.length) + n).join('')
    expect(join(['A'])).toBe('A')
    expect(join(['A', 'B'])).toBe('A and B')
    expect(join(['A', 'B', 'C'])).toBe('A, B and C')
  })
})

describe('plural', () => {
  it('adds an s except for one', () => {
    expect(plural(1, 'line')).toBe('1 line')
    expect(plural(0, 'line')).toBe('0 lines')
  })
})

describe('tintFor', () => {
  it('is stable for an id, and uses the stylesheet’s tint tokens', () => {
    expect(tintFor('mira')).toEqual(tintFor('mira'))
    expect(tintFor('mira').background).toMatch(/^var\(--tint-[1-6]-bg\)$/)
  })
})

describe('compact', () => {
  it('shortens large counts', () => {
    expect([950, 1000, 12_400, 112_000, 1_250_000].map(compact)).toEqual([
      '950',
      '1k',
      '12.4k',
      '112k',
      '1.3M',
    ])
  })
})

describe('aboutDollars', () => {
  it('says "about" before an amount, and nothing before "under"', () => {
    expect(aboutDollars(1.5)).toBe('about $1.50')
    expect(aboutDollars(0.0004)).toBe('under $0.01')
  })
})

describe('dollars', () => {
  it('writes an amount in US dollars, cents shown, a fraction of a cent as such', () => {
    expect(dollars(25)).toBe('$25.00')
    expect(dollars(12.3456)).toBe('$12.35')
    expect(dollars(0)).toBe('$0.00')
    expect(dollars(0.0004)).toBe('under $0.01')
    expect(dollars(-5)).toBe('-$5.00')
  })
})

describe('centsUp', () => {
  it('rounds an amount up to the next cent, so what is shown covers what is agreed', () => {
    expect(centsUp(0.0097)).toBe(0.01)
    expect(centsUp(0.0149)).toBe(0.02)
    expect(centsUp(1.9003949999999998)).toBe(1.91)
    expect(centsUp(0.42)).toBe(0.42)
    expect(centsUp(0)).toBe(0)
    expect(centsUp(0.4200000001)).toBe(0.43)
    // A cost a hair above a whole cent in floating point, as the review found.
    const hair = (3500 / 1e6) * 50 * 2
    expect(centsUp(hair)).toBeGreaterThanOrEqual(hair)
    for (const amount of [0.0097, 0.123456, 1.9003949999999998, 0.07, 3.3]) {
      expect(centsUp(amount)).toBeGreaterThanOrEqual(amount)
    }
  })
})

describe('clock', () => {
  it('writes seconds as m:ss', () => {
    expect(clock(80)).toBe('1:20')
    expect(clock(5)).toBe('0:05')
    expect(clock(600)).toBe('10:00')
  })
})
