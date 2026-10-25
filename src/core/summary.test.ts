import { describe, expect, it } from 'bun:test'
import { projectJson } from '../../test/helpers'
import { ProjectSchema } from './project'
import { CastSchema, type Line } from './resources'
import { displayName, sharesVoiceWith, summarize, type SummaryInput } from './summary'

const project = ProjectSchema.parse(projectJson())

function lines(...speakers: string[]): Line[] {
  return speakers.map((speaker, i) => ({ key: `k${i}`, speaker, text: `line ${i}` }))
}

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    project,
    projectFile: 'audio-studio.json',
    root: '/repo',
    dialogs: {},
    cast: null,
    problems: [],
    ...overrides,
  }
}

describe('summarize', () => {
  it('counts each part’s lines per character, most lines first', () => {
    const summary = summarize(
      input({ dialogs: { act1: { status: 'ok', lines: lines('mira', 'narrator', 'narrator') } } }),
    )
    const act1 = summary.parts[0]!
    expect(act1.dialog).toBe('ok')
    expect(act1.lineCount).toBe(3)
    expect(act1.dialogPath).toBe('tts/act1/script.json')
    expect(act1.characters).toEqual([
      { id: 'narrator', lines: 2 },
      { id: 'mira', lines: 1 },
    ])
  })

  it('reports a part without a dialog file as missing, with no lines', () => {
    const act2 = summarize(input()).parts[1]!
    expect(act2).toMatchObject({ id: 'act2', dialog: 'missing', lineCount: 0, characters: [] })
  })

  it('treats the same name in different parts as one character', () => {
    const summary = summarize(
      input({
        dialogs: {
          act1: { status: 'ok', lines: lines('narrator', 'narrator') },
          act2: { status: 'ok', lines: lines('narrator') },
        },
        cast: { speakers: { narrator: { voice: 'v1', style: '[warm]' } }, pronounce: {} },
      }),
    )
    expect(summary.characters).toMatchObject([
      {
        id: 'narrator',
        name: 'Narrator',
        voice: 'v1',
        voiceName: null,
        style: '[warm]',
        speed: null,
        keywords: [],
        appearances: [
          { part: 'act1', lines: 2 },
          { part: 'act2', lines: 1 },
        ],
        totalLines: 3,
      },
    ])
  })

  it('lists speakers missing from the cast without a voice, and cast entries that never speak', () => {
    const summary = summarize(
      input({
        dialogs: { act1: { status: 'ok', lines: lines('tilda') } },
        cast: {
          speakers: { hermit: { voice: 'v2', audition: { keywords: ['old', 'raspy'] } } },
          pronounce: {},
        },
      }),
    )
    expect(summary.characters.map((c) => [c.id, c.voice, c.totalLines, c.keywords])).toEqual([
      ['tilda', null, 1, []],
      ['hermit', 'v2', 0, ['old', 'raspy']],
    ])
  })

  it('carries the project’s labels and problems', () => {
    const problem = { file: 'tts/cast.json', path: 'speakers', message: 'bad' }
    const summary = summarize(input({ problems: [problem] }))
    expect(summary).toMatchObject({
      name: 'Test Game',
      partLabel: 'Act',
      charactersPath: 'tts/cast.json',
      root: '/repo',
      problems: [problem],
    })
  })
})

describe('summarize, pronunciations', () => {
  it('lists the table in its order, or null when the cast cannot be read', () => {
    const cast = { speakers: {}, pronounce: { 'Act I:': 'Act One:', Eldoria: 'El-door-ia' } }
    expect(summarize(input({ cast })).pronounce).toEqual([
      ['Act I:', 'Act One:'],
      ['Eldoria', 'El-door-ia'],
    ])
    expect(summarize(input()).pronounce).toBeNull()
  })
})

describe('summarize, words that sound the same', () => {
  it("gives the project's own groups and the file they are saved in", () => {
    const json = projectJson()
    ;(json.narration as { quality?: unknown }).quality = { soundAlike: [['Lyria', 'Liria']] }
    const own = ProjectSchema.parse(json)
    expect(summarize(input({ project: own }))).toMatchObject({
      soundAlike: [['Lyria', 'Liria']],
      projectFile: 'audio-studio.json',
    })
    expect(summarize(input()).soundAlike).toEqual([])
  })
})

describe('summarize, refreshing', () => {
  it('says whether the project can refresh its dialog', () => {
    expect(summarize(input()).canRefresh).toBe(false)
    const withCommand = ProjectSchema.parse(
      projectJson({ narration: { ...(projectJson().narration as object), refreshDialog: 'make' } }),
    )
    expect(summarize(input({ project: withCommand })).canRefresh).toBe(true)
  })
})

describe('displayName', () => {
  it('upper-cases the first letter only', () => {
    expect(displayName('narrator-act2')).toBe('Narrator-act2')
  })
})

describe('sharesVoiceWith', () => {
  const characters = summarize(
    input({
      dialogs: { act1: { status: 'ok', lines: lines('mira', 'tilda', 'narrator', 'aren') } },
      cast: {
        speakers: { mira: { voice: 'v1' }, tilda: { voice: 'v1' }, narrator: { voice: 'v2' } },
        pronounce: {},
      },
    }),
  ).characters

  it('names the other characters cast with the same voice', () => {
    expect(sharesVoiceWith(characters, 'mira').map((c) => c.id)).toEqual(['tilda'])
    expect(sharesVoiceWith(characters, 'narrator')).toEqual([])
  })

  it('is nobody for an uncast or unknown character', () => {
    expect(sharesVoiceWith(characters, 'aren')).toEqual([])
    expect(sharesVoiceWith(characters, 'nobody')).toEqual([])
  })
})

describe('a character per language', () => {
  const languages = ['en', 'sv']
  const several: typeof project = {
    ...project,
    narration: {
      ...project.narration,
      languages,
      paths: {
        dialog: 'tts/{part}/{language}/script.json',
        cues: 'c/{language}/{part}',
        lock: 'l/{language}/{part}',
        clips: 'a/{language}/{part}',
        manifest: 'm/{language}/{part}',
      },
    },
  }
  const cast = CastSchema.parse({
    speakers: {
      mira: {
        voice: 'v-en',
        voiceName: 'Mira EN',
        languages: { sv: { voice: 'v-sv', voiceName: 'Mira SV', speed: 0.95 } },
      },
      gran: { voice: 'v-en', languages: { sv: { voice: 'v-en' } } },
      lone: { voice: 'v-lone' },
    },
  })
  const summary = summarize(
    input({
      project: several,
      cast,
      dialogs: { act1: { status: 'ok', lines: lines('mira', 'mira', 'lone') } },
      languageDialogs: {
        sv: {
          act1: {
            status: 'ok',
            lines: [
              { key: 'a', speaker: 'mira', text: 'kort' },
              { key: 'b', speaker: 'mira', text: 'en längre rad' },
            ],
          },
        },
      },
    }),
  )
  const mira = summary.characters.find((c) => c.id === 'mira')!

  it('keeps the source language’s fields as they were', () => {
    expect(mira).toMatchObject({ voice: 'v-en', voiceName: 'Mira EN', totalLines: 2 })
  })

  it('knows each language’s voice, speed, lines and longest line', () => {
    expect(mira.languages.sv).toEqual({
      voice: 'v-sv',
      voiceName: 'Mira SV',
      speed: 0.95,
      phrase: null,
      appearances: [{ part: 'act1', lines: 2 }],
      totalLines: 2,
      longest: 'en längre rad',
    })
    expect(mira.languages.en?.longest).toBe('line 0')
  })

  it('leaves out lines too long for one take when choosing her longest', () => {
    const long = 'x'.repeat(401)
    const found = summarize(
      input({
        project: several,
        dialogs: {
          act1: {
            status: 'ok',
            lines: [
              { key: 'a', speaker: 'mira', text: 'kort' },
              { key: 'b', speaker: 'mira', text: long },
            ],
          },
        },
      }),
    )
    expect(found.characters[0]?.languages.en?.longest).toBe('kort')
  })

  it('has no voice and no lines for a language she is not in', () => {
    const lone = summary.characters.find((c) => c.id === 'lone')!
    expect(lone.languages.sv).toMatchObject({ voice: null, appearances: [], longest: null })
  })

  it('notes a shared voice only within one language', () => {
    const { characters } = summary
    expect(sharesVoiceWith(characters, 'mira', 'en').map((c) => c.id)).toEqual(['gran'])
    expect(sharesVoiceWith(characters, 'mira', 'sv')).toEqual([])
    expect(sharesVoiceWith(characters, 'gran', 'sv')).toEqual([])
  })
})
