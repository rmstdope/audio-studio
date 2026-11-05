import { describe, expect, it } from 'bun:test'
import { problemsFrom } from './project'
import {
  CastSchema,
  DialogSchema,
  LockSchema,
  NarrationEditsSchema,
  cuesOfEdits,
  formatEdits,
  pronounceOf,
  projectCast,
  sceneKey,
  ttsFor,
  voiceOf,
} from './resources'

describe('CastSchema', () => {
  it('explains a pronunciation without the word it replaces', () => {
    const result = CastSchema.safeParse({ speakers: {}, pronounce: { en: { '': 'nothing' } } })
    if (result.success) throw new Error('expected an empty key to be refused')
    expect(problemsFrom('content-studio/narration/cast.json', result.error)).toEqual([
      {
        file: 'content-studio/narration/cast.json',
        path: 'pronounce.en',
        message: 'a pronunciation needs the word it replaces; one has an empty word',
      },
    ])
  })

  it('reports a __proto__ pronunciation instead of losing it', () => {
    const result = CastSchema.safeParse(
      JSON.parse('{"speakers":{},"pronounce":{"en":{"__proto__":"x"}}}'),
    )
    if (result.success) throw new Error('expected __proto__ to be refused')
    expect(problemsFrom('content-studio/narration/cast.json', result.error)[0]).toMatchObject({
      path: 'pronounce.en',
      message: expect.stringContaining('__proto__'),
    })
  })

  it('reports pronunciations left in the old place, under languages', () => {
    const old = CastSchema.safeParse({ speakers: {}, languages: { sv: { pronounce: {} } } })
    if (old.success) throw new Error('expected a top-level languages to be refused')
    expect(problemsFrom('content-studio/narration/cast.json', old.error)).toEqual([
      {
        file: 'content-studio/narration/cast.json',
        path: 'languages',
        message:
          'pronunciations are now under pronounce.<language> (pronounce.sv), not under languages; move them there',
      },
    ])
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

  it('projects the cast: the source language’s speakers as they are, with its pronunciations', () => {
    const withTable = { ...cast, pronounce: { en: { Elior: 'El-ee-or' } } }
    expect(projectCast(withTable, 'en', 'en')).toEqual({
      speakers: cast.speakers,
      pronounce: { Elior: 'El-ee-or' },
    })
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
      pronounce: { en: { Elior: 'El-ee-or' }, sv: { Elior: 'Eli-or' } },
    })
    expect(pronounceOf(withTables, 'en')).toEqual({ Elior: 'El-ee-or' })
    expect(pronounceOf(withTables, 'sv')).toEqual({ Elior: 'Eli-or' })
    expect(pronounceOf(withTables, 'de')).toEqual({})
    expect(projectCast(withTables, 'sv', 'en').pronounce).toEqual({ Elior: 'Eli-or' })
  })

  it('reports a bad pronunciation of a language with its path', () => {
    const result = CastSchema.safeParse({
      speakers: {},
      pronounce: { sv: { '': 'nothing' } },
    })
    if (result.success) throw new Error('expected an empty key to be refused')
    expect(problemsFrom('content-studio/narration/cast.json', result.error)[0]?.path).toBe(
      'pronounce.sv',
    )
  })
})

describe('DialogSchema', () => {
  it('reads each line by its id, the rest as the game wrote it, and leaves an optional title out', () => {
    const lines = DialogSchema.parse([
      { id: 'a1', title: 'Opening', speaker: 'narrator', text: 'Hello.', scene: 'hall' },
      { id: 'a2', speaker: 'mira', text: 'Hi.' },
    ])
    expect(lines).toEqual([
      { key: 'a1', speaker: 'narrator', text: 'Hello.', scene: 'hall' },
      { key: 'a2', speaker: 'mira', text: 'Hi.' },
    ])
  })

  it('needs an id that is a safe file name, used once', () => {
    const problems = (value: unknown) => {
      const read = DialogSchema.safeParse(value)
      return read.success ? [] : read.error.issues.map((issue) => issue.path.join('.'))
    }
    expect(problems([{ key: 'a1', speaker: 'n', text: 'x' }])).toEqual(['0.id'])
    expect(problems([{ id: 'a 1', speaker: 'n', text: 'x' }])).toEqual(['0.id'])
    const twice = DialogSchema.safeParse([
      { id: 'a', speaker: 'n', text: 'x' },
      { id: 'a', speaker: 'n', text: 'y' },
    ])
    expect(twice.success ? '' : twice.error.issues[0]!.message).toContain('used more than once: a')
  })
})

describe('the narration edits', () => {
  it('reads a part’s cues by line and by scene into one table, scenes under their scene key', () => {
    const edits = NarrationEditsSchema.parse({
      cues: { a1: '[hushed]' },
      scenes: { 'lantern-hall': '[slow]' },
    })
    expect(cuesOfEdits(edits)).toEqual({ a1: '[hushed]', [sceneKey('lantern-hall')]: '[slow]' })
    expect(cuesOfEdits(NarrationEditsSchema.parse({}))).toEqual({})
  })

  it('takes only line ids under cues, so a scene key written there is reported, not read as a scene', () => {
    const wrong = NarrationEditsSchema.safeParse({ cues: { 'scene:hall': '[slow]' } })
    if (wrong.success) throw new Error('expected a scene key under cues to be refused')
    expect(problemsFrom('e.json', wrong.error).map((p) => p.path)).toEqual(['cues.scene:hall'])
    expect(NarrationEditsSchema.safeParse({ cues: { 'a_1-B': '[x]' } }).success).toBe(true)
  })

  it('refuses a field it does not know, so an old flat file is reported', () => {
    const old = NarrationEditsSchema.safeParse({ a1: '[hushed]' })
    expect(old.success).toBe(false)
  })

  it('writes the cues and the scenes apart, one cue to a line, in the order given', () => {
    expect(
      formatEdits([
        ['b', '[sad]'],
        [sceneKey('Cave'), '[dark]'],
        ['a', '[x]'],
      ]),
    ).toBe(
      '{\n  "cues": {\n    "b": "[sad]",\n    "a": "[x]"\n  },\n' +
        '  "scenes": {\n    "Cave": "[dark]"\n  }\n}\n',
    )
    expect(formatEdits([])).toBe('{\n  "cues": {},\n  "scenes": {}\n}\n')
  })
})

describe('the narration lock', () => {
  const entry = {
    fp: '8c67d33efba8d9af',
    voice: 'v1',
    model: 's2.1-pro-free',
    hashes: { cue: 'a', text: 'b', said: 'c', settings: 'd' },
    heard: 1,
    takes: 1,
    at: '2026-11-04T09:56:41.790Z',
  }

  it('keeps each line’s short hashes under hashes', () => {
    expect(LockSchema.parse({ a1: entry }).a1!.hashes).toEqual(entry.hashes)
  })

  it('refuses an entry without them', () => {
    const { hashes, ...old } = entry
    expect(LockSchema.safeParse({ a1: { ...old, parts: hashes } }).success).toBe(false)
  })
})
