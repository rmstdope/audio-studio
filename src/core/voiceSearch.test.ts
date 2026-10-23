import { describe, expect, it } from 'bun:test'
import { hasWords, rankVoices, searchTerms, type Voice } from './voiceSearch'

function voice(id: string, overrides: Partial<Voice> = {}): Voice {
  return {
    id,
    title: id,
    description: '',
    tags: [],
    languages: ['en'],
    uses: 0,
    likes: 0,
    author: 'someone',
    sample: null,
    ...overrides,
  }
}

describe('searchTerms', () => {
  it('searches each keyword and each of its words once, in lower case', () => {
    expect(searchTerms(['Elderly female', 'warm', ' ', 'female'])).toEqual([
      'elderly female',
      'warm',
      'female',
      'elderly',
    ])
  })
})

describe('searchTerms, skipping what cannot match', () => {
  it('drops keywords without letters or digits, and one-letter words', () => {
    expect(searchTerms(['-', 'grandma’s voice'])).toEqual(['grandma’s voice', "grandma's", 'voice'])
  })
})

describe('words in quotes and apostrophes', () => {
  it('matches words inside quotes, curly or straight', () => {
    const ranked = rankVoices(
      [voice('a', { title: '‘Wise’ elder' }), voice('b', { title: "'Old Man' narrator" })],
      ['wise', 'old man'],
      new Set(),
    )
    expect(ranked.map((c) => [c.voice.id, c.matched])).toEqual([
      ['a', ['wise']],
      ['b', ['old man']],
    ])
  })

  it('treats both apostrophes alike', () => {
    const ranked = rankVoices([voice('a', { title: 'Grandma’s voice' })], ["grandma's"], new Set())
    expect(ranked.map((c) => c.voice.id)).toEqual(['a'])
  })

  it('does not count apostrophes alone as words', () => {
    expect(hasWords("'")).toBe(false)
    expect(hasWords('’')).toBe(false)
    expect(searchTerms(["'", 'a', 'warm'])).toEqual(['warm'])
  })
})

describe('rankVoices', () => {
  it('does not let a keyword without words match every voice', () => {
    const ranked = rankVoices([voice('a', { title: 'Young man' })], ['-', 'warm'], new Set())
    expect(ranked).toEqual([])
  })

  const keywords = ['elderly female', 'warm', 'storyteller']

  it('keeps voices matching at least one keyword, most keywords first, then most used', () => {
    const ranked = rankVoices(
      [
        voice('a', { title: 'Warm Granny', tags: ['elderly', 'female'], uses: 100 }),
        voice('b', { description: 'A warm voice', uses: 500 }),
        voice('c', { title: 'Young man', uses: 9000 }),
        voice('d', { title: 'Storyteller', description: 'warm', uses: 50 }),
      ],
      keywords,
      new Set(),
    )
    expect(ranked.map((c) => [c.voice.id, c.matched])).toEqual([
      ['a', ['elderly female', 'warm']],
      ['d', ['warm', 'storyteller']],
      ['b', ['warm']],
    ])
  })

  it('matches whole words only, ignoring case and punctuation', () => {
    const ranked = rankVoices(
      [voice('a', { title: 'Warmth' }), voice('b', { title: 'WARM, deep' })],
      ['warm'],
      new Set(),
    )
    expect(ranked.map((c) => c.voice.id)).toEqual(['b'])
  })

  it('needs every word of a keyword', () => {
    const ranked = rankVoices([voice('a', { title: 'Elderly man' })], ['elderly female'], new Set())
    expect(ranked).toEqual([])
  })

  it('leaves out excluded voices and duplicates', () => {
    const ranked = rankVoices(
      [voice('a', { title: 'warm' }), voice('a', { title: 'warm' }), voice('b', { title: 'warm' })],
      ['warm'],
      new Set(['b']),
    )
    expect(ranked.map((c) => c.voice.id)).toEqual(['a'])
  })
})
