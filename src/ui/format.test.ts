import { describe, expect, it } from 'bun:test'
import { longTitle, plural, shortTitle, tintFor, voiceLabel } from './format'

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
