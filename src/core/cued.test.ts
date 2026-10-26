import { describe, expect, it } from 'bun:test'
import { composeCued, normalizeCue, parseCued, piecesOf, withInside } from './cued'

const TEXT = 'I did it. I will fix it.'

describe('parseCued', () => {
  it('reads an entry with no words as a plain opening cue', () => {
    expect(parseCued('[whispering]', TEXT)).toEqual({
      opening: '[whispering]',
      inside: [],
      stale: null,
    })
    expect(parseCued('speak slowly', TEXT).opening).toBe('speak slowly')
  })

  it('keeps a bracket-led cue with plain words as a plain opening cue', () => {
    expect(parseCued('[sad] very slowly', TEXT)).toEqual({
      opening: '[sad] very slowly',
      inside: [],
      stale: null,
    })
  })

  it('splits the opening cue from the cues inside', () => {
    expect(parseCued('[ashamed] I did it. [resolute] I will fix it.', TEXT)).toEqual({
      opening: '[ashamed]',
      inside: [{ at: 3, cue: '[resolute]' }],
      stale: null,
    })
  })

  it('reads an entry with no opening cue', () => {
    const parsed = parseCued('I did it. [low] I will fix it.', TEXT)
    expect(parsed.opening).toBe('')
    expect(parsed.inside).toEqual([{ at: 3, cue: '[low]' }])
  })

  it('sets the cues aside when the words changed, keeping the opening cue', () => {
    const entry = '[ashamed] I did it. [resolute] I will mend it.'
    expect(parseCued(entry, TEXT)).toEqual({ opening: '[ashamed]', inside: [], stale: entry })
  })

  it('treats a cue after the last word as not fitting', () => {
    const entry = '[a] I did it. I will fix it. [b]'
    expect(parseCued(entry, TEXT).stale).toBe(entry)
  })

  it('ignores differences in whitespace between the words', () => {
    expect(parseCued('[a] I did\nit. [b] I will fix it.', TEXT).inside).toEqual([
      { at: 3, cue: '[b]' },
    ])
  })
})

describe('composeCued', () => {
  it('gives the opening cue alone when nothing is inside', () => {
    expect(composeCued('[a]', [], TEXT)).toBe('[a]')
    expect(composeCued('', [], TEXT)).toBe('')
  })

  it('puts each cue before its word', () => {
    expect(composeCued('[a]', [{ at: 3, cue: '[b]' }], TEXT)).toBe(
      '[a] I did it. [b] I will fix it.',
    )
    expect(composeCued('', [{ at: 1, cue: '[b]' }], TEXT)).toBe('I [b] did it. I will fix it.')
  })

  it('round-trips with parseCued', () => {
    const inside = [
      { at: 1, cue: '[x]' },
      { at: 4, cue: '[y]' },
    ]
    expect(parseCued(composeCued('[o]', inside, TEXT), TEXT)).toEqual({
      opening: '[o]',
      inside,
      stale: null,
    })
  })
})

describe('withInside', () => {
  it('adds, replaces and removes the cue at a gap, in word order', () => {
    const one = withInside([], 3, '[b]')
    const two = withInside(one, 1, '[a]')
    expect(two).toEqual([
      { at: 1, cue: '[a]' },
      { at: 3, cue: '[b]' },
    ])
    expect(withInside(two, 3, '[c]')[1]).toEqual({ at: 3, cue: '[c]' })
    expect(withInside(two, 1, '')).toEqual([{ at: 3, cue: '[b]' }])
  })
})

describe('normalizeCue', () => {
  it('adds brackets when absent and leaves them when present', () => {
    expect(normalizeCue(' whispering ')).toBe('[whispering]')
    expect(normalizeCue('[break]')).toBe('[break]')
    expect(normalizeCue('  ')).toBe('')
  })
})

describe('piecesOf', () => {
  const chunks = ['One two three.', 'Four five six.', 'Seven eight.']

  it('starts each piece with the cue in effect at that point', () => {
    const pieces = piecesOf(chunks, '[open]', [
      { at: 1, cue: '[a]' },
      { at: 5, cue: '[b]' },
    ])
    expect(pieces.map((p) => p.cue)).toEqual(['[open]', '[a]', '[b]'])
    expect(pieces[0]!.inside).toEqual([{ at: 1, cue: '[a]' }])
    expect(pieces[1]!.inside).toEqual([{ at: 2, cue: '[b]' }])
    expect(pieces[2]!.inside).toEqual([])
  })

  it('makes a cue exactly at a piece start that piece’s own, not repeated inside', () => {
    const pieces = piecesOf(chunks, '[open]', [{ at: 3, cue: '[a]' }])
    expect(pieces[1]!.cue).toBe('[a]')
    expect(pieces[1]!.inside).toEqual([])
    expect(pieces[2]!.cue).toBe('[a]')
  })
})
