import { describe, expect, it } from 'bun:test'
import { problemsFrom } from './project'
import { CastSchema, ttsFor } from './resources'

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

  it('reports a __proto__ pronunciation instead of losing it', () => {
    const result = CastSchema.safeParse(JSON.parse('{"speakers":{},"pronounce":{"__proto__":"x"}}'))
    if (result.success) throw new Error('expected __proto__ to be refused')
    expect(problemsFrom('tts/cast.json', result.error)[0]).toMatchObject({
      path: 'pronounce',
      message: expect.stringContaining('__proto__'),
    })
  })

  it('refuses a speed Fish cannot speak at', () => {
    const slow = CastSchema.safeParse({ speakers: { a: { speed: 0.2 } } })
    const fast = CastSchema.safeParse({ speakers: { a: { speed: 2.5 } } })
    expect(slow.success || fast.success).toBe(false)
    expect(CastSchema.safeParse({ speakers: { a: { speed: 1.5 } } }).success).toBe(true)
  })
})

describe('ttsFor', () => {
  const tts = { temperature: 0.7, topP: 0.7, speed: 1 }

  it('speaks a character at the project’s settings, with its own speed when it has one', () => {
    expect(ttsFor(tts, {})).toEqual(tts)
    expect(ttsFor(tts, undefined)).toEqual(tts)
    expect(ttsFor(tts, { speed: 0.85 })).toEqual({ ...tts, speed: 0.85 })
  })
})
