import { describe, expect, it } from 'bun:test'
import { problemsFrom } from './project'
import { CastSchema } from './resources'

describe('CastSchema', () => {
  it('explains a pronunciation without the word it replaces', () => {
    const result = CastSchema.safeParse({ speakers: {}, pronounce: { '': 'nothing' } })
    if (result.success) throw new Error('expected an empty key to be refused')
    expect(problemsFrom('tts/cast.json', result.error)).toEqual([
      {
        file: 'tts/cast.json',
        path: 'pronounce',
        message: 'a pronunciation needs the word it replaces; one has an empty word',
      },
    ])
  })
})
