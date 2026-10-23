import { describe, expect, it } from 'bun:test'
import { chunkText, saidText, spokenText } from './spoken'

describe('spokenText', () => {
  it('adds the cue and says names as cast', () => {
    expect(spokenText('Act I: The Call to Adventure', '[grand]', { 'Act I:': 'Act One:' })).toBe(
      '[grand] Act One: The Call to Adventure',
    )
  })

  it('reads checklist bullets as a list, not as asterisks', () => {
    expect(spokenText('You will need: * Warm clothing * A map', '', {})).toBe(
      'You will need: Warm clothing, A map',
    )
  })

  it('has no leading space without a cue', () => {
    expect(spokenText('Hello.', '', {})).toBe('Hello.')
  })
})

describe('saidText', () => {
  it('replaces every occurrence, in the order the table lists them', () => {
    expect(saidText('Elior, Elior!', { Elior: 'El-ee-or' })).toBe('El-ee-or, El-ee-or!')
  })
})

describe('chunkText', () => {
  it('keeps short lines whole', () => {
    expect(chunkText('A storm. Then quiet.', 400)).toEqual(['A storm. Then quiet.'])
  })

  it('splits long lines at sentence ends', () => {
    const text = 'First sentence here. Second one is a bit longer. Third.'
    const chunks = chunkText(text, 30)
    expect(chunks).toEqual(['First sentence here.', 'Second one is a bit longer.', 'Third.'])
    expect(chunks.join(' ')).toBe(text)
  })

  it('keeps an overlong sentence whole', () => {
    const text = 'This single sentence is far longer than the limit.'
    expect(chunkText(text, 10)).toEqual([text])
  })
})
