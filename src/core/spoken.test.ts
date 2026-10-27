import { describe, expect, it } from 'bun:test'
import { chunkText, saidText, sentPieces, spokenPieces, spokenText } from './spoken'

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

describe('saidText, as Python’s str.replace does it', () => {
  it('takes $ in a pronunciation literally', () => {
    expect(saidText('Pay the toll', { toll: 'fee of $$5 $& more' })).toBe(
      'Pay the fee of $$5 $& more',
    )
  })
})

describe('chunkText', () => {
  it('counts characters, not UTF-16 units, like Python’s len', () => {
    const text = 'A😀😀😀. B.'
    expect(chunkText(text, 10)).toEqual([text])
  })

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

describe('spokenPieces', () => {
  it('is each piece of a line with the cue and pronunciations, as sent to Fish', () => {
    expect(spokenPieces('Elior waits. He waits.', '[low]', { Elior: 'El-ee-or' }, 14)).toEqual([
      '[low] El-ee-or waits.',
      '[low] He waits.',
    ])
  })
})

describe('spokenPieces with cues inside', () => {
  const text = 'One two three. Four five six. Seven eight.'

  it('is as it was without cues inside', () => {
    expect(spokenPieces(text, '[o]', {}, 15, [])).toEqual(spokenPieces(text, '[o]', {}, 15))
  })

  it('sends each cue where it was placed', () => {
    expect(spokenPieces('One two three.', '[o]', {}, 100, [{ at: 1, cue: '[a]' }])).toEqual([
      '[o] One [a] two three.',
    ])
  })

  it('starts each piece with the cue in effect there, not the opening cue again', () => {
    expect(
      spokenPieces(text, '[o]', {}, 15, [
        { at: 1, cue: '[a]' },
        { at: 5, cue: '[b]' },
      ]),
    ).toEqual(['[o] One [a] two three.', '[a] Four five [b] six.', '[b] Seven eight.'])
  })

  it('says each stretch as cast', () => {
    expect(
      spokenPieces('Elior ran home.', '', { Elior: 'El-ee-or' }, 100, [{ at: 1, cue: '[a]' }]),
    ).toEqual(['El-ee-or [a] ran home.'])
  })
})

describe('sentPieces', () => {
  const line = { text: 'Come in. Sit down.', cue: '[soft]', inside: [{ at: 2, cue: '[low]' }] }
  it('sends the cues to a model that reads them, as spokenPieces does', () => {
    expect(sentPieces(line, 's2-pro', {}, 300)).toEqual(
      spokenPieces(line.text, line.cue, {}, 300, line.inside),
    )
    expect(sentPieces(line, 'eleven_v3', {}, 300)).toEqual(['[soft] Come in. [low] Sit down.'])
  })

  it('sends none to a model that would speak them', () => {
    expect(sentPieces(line, 'eleven_multilingual_v2', {}, 300)).toEqual(['Come in. Sit down.'])
  })
})
