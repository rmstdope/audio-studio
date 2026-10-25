import { describe, expect, it } from 'bun:test'
import { setDesigned, startSession } from './audition'
import {
  MAX_CHARS,
  descriptionState,
  designCredit,
  designPoints,
  designGroups,
  designStart,
  previewText,
  quoted,
  savedName,
} from './design'
import type { Voice } from './voiceSearch'

describe('descriptionState', () => {
  it('cannot send an empty or blank description', () => {
    expect(descriptionState('').canSend).toBe(false)
    expect(descriptionState('  \n ').canSend).toBe(false)
    expect(descriptionState('a warm voice').canSend).toBe(true)
  })

  it('shows a count from 1,800 characters and a red line past 2,000', () => {
    expect(descriptionState('x'.repeat(1799)).count).toBeNull()
    expect(descriptionState('x'.repeat(1800)).count).toBe('1,800 / 2,000')
    const full = descriptionState('x'.repeat(MAX_CHARS))
    expect(full).toEqual({ canSend: true, count: '2,000 / 2,000', tooLong: null })
    const over = descriptionState('x'.repeat(MAX_CHARS + 1))
    expect(over.canSend).toBe(false)
    expect(over.tooLong).toBe('That’s longer than Fish takes: 2,000 characters at most.')
  })

  it('counts characters, not bytes', () => {
    expect(descriptionState('é'.repeat(MAX_CHARS)).canSend).toBe(true)
  })
})

describe('designStart', () => {
  it('makes a start from the keywords and the delivery', () => {
    expect(
      designStart(['elderly female', 'warm', 'storyteller'], 'Slow, warm, a little hoarse.'),
    ).toBe('Elderly female, warm, storyteller. Slow, warm, a little hoarse.')
  })

  it('uses what there is', () => {
    expect(designStart(['warm'], '')).toBe('Warm.')
    expect(designStart([], 'Slow.')).toBe('Slow.')
    expect(designStart([], '  ')).toBe('')
  })
})

describe('previewText', () => {
  it('keeps a short phrase and cuts a long one at a word', () => {
    expect(previewText('Hello there.')).toBe('Hello there.')
    const long = 'word '.repeat(60).trim()
    const cut = previewText(long)
    expect([...cut].length).toBeLessThanOrEqual(150)
    expect(long.startsWith(cut)).toBe(true)
    expect(cut.endsWith('word')).toBe(true)
  })
})

describe('savedName', () => {
  it('uses the first free name', () => {
    expect(savedName('Mara', [])).toBe('Mara (designed)')
    expect(savedName('Mara', ['Mara (designed)'])).toBe('Mara (designed 2)')
    expect(savedName('Mara', ['Mara (designed)', 'Mara (designed 2)', 'Other'])).toBe(
      'Mara (designed 3)',
    )
  })
})

describe('quoted', () => {
  it('quotes the description, cutting a long one', () => {
    expect(quoted('An old woman')).toBe('“An old woman”')
    expect(quoted('x'.repeat(100))).toBe(`“${'x'.repeat(80)}…”`)
  })
})

describe('designGroups', () => {
  function design(id: string, n: number, at: string, description: string): Voice {
    return {
      id,
      title: `Design ${n}`,
      description: '',
      tags: [],
      languages: [],
      uses: 0,
      likes: 0,
      author: '',
      sample: null,
      design: { n, description, at },
    }
  }

  it('groups by request, newest first, each in the order made', () => {
    const empty = startSession({
      character: 'mara',
      keywords: [],
      current: null,
      candidates: [],
      perRound: 3,
    })
    const session = setDesigned(
      empty,
      [
        design('a', 1, '2026-10-25T10:00:00Z', 'old'),
        design('b', 2, '2026-10-25T10:00:00Z', 'old'),
        design('c', 3, '2026-10-25T11:00:00Z', 'newer'),
      ],
      [],
    )
    expect(designGroups(session)).toEqual([
      { at: '2026-10-25T11:00:00Z', description: 'newer', voices: ['c'] },
      { at: '2026-10-25T10:00:00Z', description: 'old', voices: ['a', 'b'] },
    ])
  })

  it('has no groups without designs', () => {
    const empty = startSession({
      character: 'mara',
      keywords: [],
      current: null,
      candidates: [],
      perRound: 3,
    })
    expect(designGroups(empty)).toEqual([])
  })
})

describe('designCredit', () => {
  it('asks while the credit covers a design, and says why not otherwise', () => {
    expect(designCredit(undefined)).toEqual({ kind: 'reading' })
    expect(designCredit(4.82)).toEqual({ kind: 'ask', credit: 4.82 })
    expect(designCredit(0.01)).toEqual({ kind: 'ask', credit: 0.01 })
    expect(designCredit(0)).toEqual({
      kind: 'cannot',
      message:
        'Your credit is $0.00, not enough for a design ($0.01). Add credit on Fish and try again.',
    })
    expect(designCredit(null)).toEqual({
      kind: 'cannot',
      message:
        'The studio couldn’t read your Fish credit, so it can’t tell whether a design is covered. Check the Fish key on Setup and try again.',
    })
  })
})

describe('designPoints', () => {
  it('says what a design does, with a third point when it starts an audition', () => {
    const two = designPoints('Mara', true)
    expect(two).toEqual([
      'Fish makes 4 voices from your description, each saying the audition phrase.',
      'It costs $0.01, charged to your Fish account only if it works.',
    ])
    expect(designPoints('Mara', false)).toEqual([
      ...two,
      'No audition is going on for Mara: this starts one, and the voices join its board.',
    ])
  })
})
