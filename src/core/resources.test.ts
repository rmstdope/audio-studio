import { describe, expect, it } from 'bun:test'
import { problemsFrom } from './project'
import { CastSchema, pronounceOf, projectCast, ttsFor, voiceOf } from './resources'

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

describe('a character per language', () => {
  const cast = CastSchema.parse({
    speakers: {
      gran: {
        voice: 'en-voice',
        voiceName: 'Gentle Granny',
        style: '[warm]',
        speed: 0.9,
        audition: { keywords: ['warm'], phrase: 'Come in.' },
        languages: {
          sv: { voice: 'sv-voice', voiceName: 'Varm Mormor', speed: 0.95, phrase: 'Kom in.' },
        },
      },
      mira: { voice: 'm-voice', voiceName: 'Mira' },
    },
  })

  it('reads the language voices of a character', () => {
    expect(cast.speakers.gran?.languages?.sv?.voice).toBe('sv-voice')
  })

  it('refuses a language speed Fish cannot speak at', () => {
    expect(
      CastSchema.safeParse({ speakers: { a: { languages: { sv: { speed: 3 } } } } }).success,
    ).toBe(false)
  })

  it('gives the source language the top-level fields', () => {
    expect(voiceOf(cast.speakers.gran!, 'en', 'en')).toEqual({
      voice: 'en-voice',
      voiceName: 'Gentle Granny',
      speed: 0.9,
      phrase: 'Come in.',
    })
  })

  it('gives another language its own fields, and nothing of the source language', () => {
    expect(voiceOf(cast.speakers.gran!, 'sv', 'en')).toEqual({
      voice: 'sv-voice',
      voiceName: 'Varm Mormor',
      speed: 0.95,
      phrase: 'Kom in.',
    })
    expect(voiceOf(cast.speakers.mira!, 'sv', 'en')).toEqual({
      voice: null,
      voiceName: null,
      speed: null,
      phrase: null,
    })
  })

  it('projects the cast: the source language is as it is', () => {
    expect(projectCast(cast, 'en', 'en')).toBe(cast)
  })

  it('projects the cast into a language: its voice, speed and phrase in the top-level places', () => {
    const sv = projectCast(cast, 'sv', 'en')
    expect(sv.speakers.gran).toMatchObject({
      voice: 'sv-voice',
      voiceName: 'Varm Mormor',
      speed: 0.95,
      style: '[warm]',
      audition: { keywords: ['warm'], phrase: 'Kom in.' },
    })
    expect(sv.speakers.mira?.voice).toBeUndefined()
    // Pronunciations are kept per language: this one has none of its own.
    expect(sv.pronounce).toEqual({})
  })

  it('reads a language’s own pronunciations, and applies them to that language only', () => {
    const withTables = CastSchema.parse({
      speakers: {},
      pronounce: { Elior: 'El-ee-or' },
      languages: { sv: { pronounce: { Elior: 'Eli-or' } } },
    })
    expect(pronounceOf(withTables, 'en', 'en')).toEqual({ Elior: 'El-ee-or' })
    expect(pronounceOf(withTables, 'sv', 'en')).toEqual({ Elior: 'Eli-or' })
    expect(pronounceOf(withTables, 'de', 'en')).toEqual({})
    expect(projectCast(withTables, 'sv', 'en').pronounce).toEqual({ Elior: 'Eli-or' })
  })

  it('reports a bad pronunciation of a language with its path', () => {
    const result = CastSchema.safeParse({
      speakers: {},
      languages: { sv: { pronounce: { '': 'nothing' } } },
    })
    if (result.success) throw new Error('expected an empty key to be refused')
    expect(problemsFrom('tts/cast.json', result.error)[0]?.path).toBe('languages.sv.pronounce')
  })
})
