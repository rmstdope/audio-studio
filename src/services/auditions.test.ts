import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Voice } from '../core/voiceSearch'
import {
  characterVoice,
  findCandidates,
  setKeywords,
  setPhrase,
  setPronunciations,
  setSpeed,
  setStyle,
  setVoice,
} from './auditions'
import { createLimiter } from './limit'
import { recordTake } from './takes'
import type { FishClient } from './fish'

function voice(id: string, title: string, uses = 0): Voice {
  return {
    id,
    title,
    description: '',
    tags: [],
    languages: ['en'],
    uses,
    likes: 0,
    author: '',
    sample: null,
  }
}

const library = [
  voice('cur', 'warm current', 1),
  voice('w1', 'warm granny', 90),
  voice('w2', 'warm', 10),
]

const fish: FishClient = {
  async listOwnVoices() {
    return []
  },
  async credit() {
    return 25
  },
  async listVoices(query) {
    const items = library.filter((v) => v.title.includes(query.title ?? ''))
    return { total: items.length, items }
  },
  async getVoice(id) {
    const found = library.find((v) => v.id === id)
    if (!found) throw new Error('gone')
    return found
  },
  async tts() {
    return new Uint8Array([0x49, 0x44, 0x33])
  },
}

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': {
    speakers: { grandmother: { voice: 'cur', style: '[warm]', audition: { keywords: ['warm'] } } },
    pronounce: {},
  },
  'tts/act1/script.json': [
    { key: 'a', speaker: 'grandmother', text: 'Hello.' },
    { key: 'b', speaker: 'tilda', text: 'Hi.' },
  ],
}

describe('findCandidates', () => {
  it('searches with the character’s keywords, leaving out its current voice', async () => {
    const root = tempRepo(files)
    const result = await findCandidates(
      join(root, 'audio-studio.json'),
      'grandmother',
      async () => fish,
    )
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.keywords).toEqual(['warm'])
    expect(result.current?.id).toBe('cur')
    expect(result.candidates.map((c) => c.voice.id)).toEqual(['w1', 'w2'])
  })

  it('gives the audition phrase and the takes already recorded', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const limiter = createLimiter()
    const recorded = await recordTake(projectFile, 'grandmother', 'w1', async () => fish, limiter)
    const result = await findCandidates(projectFile, 'grandmother', async () => fish)
    if (!result?.ok || !recorded?.ok) throw new Error('expected both to work')
    expect(result.audition.from).toBe('standard')
    expect(result.audition.spoken).toStartWith('[warm] ')
    expect(result.takes).toEqual({ w1: recorded.key })
  })

  it('reports a broken cast instead of guessing the phrase', async () => {
    const root = tempRepo({ ...files, 'tts/cast.json': '{ broken' })
    const result = await findCandidates(join(root, 'audio-studio.json'), 'tilda', async () => fish)
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.file).toBe(
      'tts/cast.json',
    )
  })

  it('finds nothing for a character without keywords', async () => {
    const root = tempRepo(files)
    const result = await findCandidates(join(root, 'audio-studio.json'), 'tilda', async () => fish)
    expect(result?.ok && [result.keywords, result.candidates, result.current]).toEqual([
      [],
      [],
      null,
    ])
  })

  it('says so when there is no API key', async () => {
    const root = tempRepo(files)
    const result = await findCandidates(
      join(root, 'audio-studio.json'),
      'grandmother',
      async () => null,
    )
    expect(result).toMatchObject({ ok: false, reason: 'no-key' })
  })

  it('passes on what Fish said when it fails, even when it is not an Error', async () => {
    const root = tempRepo(files)
    const failing: FishClient = { ...fish, listVoices: () => Promise.reject('down') }
    const result = await findCandidates(
      join(root, 'audio-studio.json'),
      'grandmother',
      async () => failing,
    )
    expect(result).toEqual({ ok: false, reason: 'fish', message: 'down' })
  })

  it('passes on what Fish said when it fails', async () => {
    const root = tempRepo(files)
    const failing: FishClient = { ...fish, listVoices: () => Promise.reject(new Error('boom')) }
    const result = await findCandidates(
      join(root, 'audio-studio.json'),
      'grandmother',
      async () => failing,
    )
    expect(result).toEqual({ ok: false, reason: 'fish', message: 'boom' })
  })

  it('returns null for a character the project does not have', async () => {
    const root = tempRepo(files)
    expect(
      await findCandidates(join(root, 'audio-studio.json'), 'nobody', async () => fish),
    ).toBeNull()
  })
})

describe('characterVoice', () => {
  it('gives the cast voice as Fish knows it, its take and the audition phrase', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const recorded = await recordTake(
      projectFile,
      'grandmother',
      'cur',
      async () => fish,
      createLimiter(),
    )
    const result = await characterVoice(projectFile, 'grandmother', async () => fish)
    if (!result?.ok || !recorded?.ok) throw new Error(JSON.stringify(result))
    expect([result.id, result.voice?.title]).toEqual(['cur', 'warm current'])
    expect(result.lookup).toBeNull()
    expect(result.take).toBe(recorded.key)
    expect(result.audition.spoken).toStartWith('[warm] ')
    expect(result.language).toBe('en')
  })

  it('has no voice for a character not cast, and asks Fish nothing', async () => {
    const root = tempRepo(files)
    let asked = 0
    const counting: FishClient = { ...fish, getVoice: (id) => (asked++, fish.getVoice(id)) }
    const result = await characterVoice(
      join(root, 'audio-studio.json'),
      'tilda',
      async () => counting,
    )
    expect(result).toMatchObject({ ok: true, id: null, voice: null, lookup: null, take: null })
    expect(asked).toBe(0)
  })

  it('says why Fish could not give the details, without a key or when it fails', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const keyless = await characterVoice(projectFile, 'grandmother', async () => null)
    expect(keyless).toMatchObject({ ok: true, voice: null })
    expect(keyless?.ok && keyless.lookup?.reason).toBe('no-key')
    expect(keyless?.ok && keyless.lookup?.message).toContain('FISH_AUDIO_API_KEY')
    const failing: FishClient = { ...fish, getVoice: () => Promise.reject(new Error('busy')) }
    const failed = await characterVoice(projectFile, 'grandmother', async () => failing)
    expect(failed).toMatchObject({
      ok: true,
      id: 'cur',
      voice: null,
      lookup: { reason: 'fish', message: 'busy' },
    })
  })

  it('reports a broken cast, and answers an unknown character with null', async () => {
    const broken = tempRepo({ ...files, 'tts/cast.json': '{ broken' })
    const result = await characterVoice(
      join(broken, 'audio-studio.json'),
      'tilda',
      async () => fish,
    )
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.file).toBe(
      'tts/cast.json',
    )
    const root = tempRepo(files)
    expect(
      await characterVoice(join(root, 'audio-studio.json'), 'nobody', async () => fish),
    ).toBeNull()
  })
})

describe('setPhrase', () => {
  it('saves a character’s own phrase, and clears it again', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setPhrase(projectFile, 'grandmother', '  Come in, dear.  ')).toEqual({ ok: true })
    let cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother.audition).toEqual({
      keywords: ['warm'],
      phrase: 'Come in, dear.',
    })
    await setPhrase(projectFile, 'grandmother', '   ')
    cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother.audition).toEqual({ keywords: ['warm'] })
  })
})

describe('clearing audition fields', () => {
  it('leaves no empty audition entry behind', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': { speakers: { grandmother: { voice: 'cur' } }, pronounce: {} },
    })
    const projectFile = join(root, 'audio-studio.json')
    await setPhrase(projectFile, 'grandmother', null)
    await setKeywords(projectFile, 'grandmother', ['warm'])
    await setKeywords(projectFile, 'grandmother', [])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother).toEqual({ voice: 'cur' })
  })

  it('keeps the entry’s order when clearing an audition between other fields', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json':
        '{\n  "speakers": {\n    "grandmother": { "voice": "cur", "audition": { "phrase": "Hi." }, "style": "[warm]" }\n  }\n}\n',
    })
    await setPhrase(join(root, 'audio-studio.json'), 'grandmother', null)
    expect(readFileSync(join(root, 'tts/cast.json'), 'utf8')).toBe(
      '{\n  "speakers": {\n    "grandmother": { "voice": "cur", "style": "[warm]" }\n  }\n}\n',
    )
  })

  it('treats a null phrase as no phrase when clearing', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': {
        speakers: { grandmother: { audition: { phrase: null, keywords: ['a'] } } },
      },
    })
    await setKeywords(join(root, 'audio-studio.json'), 'grandmother', [])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother).toEqual({})
  })

  it('answers an unknown character with null, whatever its phrase', async () => {
    const root = tempRepo(files)
    expect(await setPhrase(join(root, 'audio-studio.json'), 'nobody', 'x'.repeat(401))).toBeNull()
  })

  it('refuses a phrase too long for one take', async () => {
    const root = tempRepo(files)
    const result = await setPhrase(join(root, 'audio-studio.json'), 'grandmother', 'x'.repeat(401))
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.message).toContain(
      '400',
    )
  })
})

describe('setKeywords', () => {
  it('saves the keywords in the cast, keeping the rest of the entry', async () => {
    const root = tempRepo(files)
    const result = await setKeywords(join(root, 'audio-studio.json'), 'grandmother', [
      ' old ',
      'warm',
      'old',
    ])
    expect(result).toEqual({ ok: true })
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother).toEqual({
      voice: 'cur',
      style: '[warm]',
      audition: { keywords: ['old', 'warm'] },
    })
  })

  it('keeps both of two changes made at once', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await Promise.all([
      setKeywords(projectFile, 'grandmother', ['old']),
      setKeywords(projectFile, 'tilda', ['chatty']),
    ])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother.audition.keywords).toEqual(['old'])
    expect(cast.speakers.tilda.audition.keywords).toEqual(['chatty'])
  })

  it('treats keywords differing only in case as one, and drops ones without words', async () => {
    const root = tempRepo(files)
    await setKeywords(join(root, 'audio-studio.json'), 'grandmother', ['Warm', 'warm', '-', 'old'])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother.audition.keywords).toEqual(['Warm', 'old'])
  })

  it('changes nothing in the cast but the character', async () => {
    const original =
      '{\n  "pronounce": { "Act I:": "Act One:" },\n  "speakers": {\n' +
      '    "grandmother": { "voice": "cur" }\n  },\n  "notes": "keep me"\n}\n'
    const root = tempRepo({ ...files, 'tts/cast.json': original })
    await setKeywords(join(root, 'audio-studio.json'), 'grandmother', ['old'])
    expect(readFileSync(join(root, 'tts/cast.json'), 'utf8')).toBe(
      '{\n  "pronounce": { "Act I:": "Act One:" },\n  "speakers": {\n' +
        '    "grandmother": { "voice": "cur", "audition": { "keywords": ["old"] } }\n' +
        '  },\n  "notes": "keep me"\n}\n',
    )
  })

  it('writes a cast whose numeric pronunciation could not move', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': { speakers: {}, pronounce: { '1': 'one' } },
    })
    const result = await setKeywords(join(root, 'audio-studio.json'), 'tilda', ['chatty'])
    expect(result).toEqual({ ok: true })
  })

  it('refuses to rewrite a cast whose pronunciations would change order', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': { speakers: {}, pronounce: { 'Act I:': 'Act One:', '10': 'ten' } },
    })
    const result = await setKeywords(join(root, 'audio-studio.json'), 'tilda', ['chatty'])
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.message).toContain(
      '"10"',
    )
  })

  it('adds an entry for a speaker not in the cast yet', async () => {
    const root = tempRepo(files)
    await setKeywords(join(root, 'audio-studio.json'), 'tilda', ['chatty'])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.tilda).toEqual({ audition: { keywords: ['chatty'] } })
  })

  it('creates the cast file if there is none', async () => {
    const root = tempRepo({ ...files, 'tts/cast.json': undefined })
    await setKeywords(join(root, 'audio-studio.json'), 'tilda', ['chatty'])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast).toEqual({
      speakers: { tilda: { audition: { keywords: ['chatty'] } } },
      pronounce: {},
    })
  })

  it('refuses to write over a broken cast', async () => {
    const root = tempRepo({ ...files, 'tts/cast.json': '{ broken' })
    const result = await setKeywords(join(root, 'audio-studio.json'), 'tilda', ['chatty'])
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.file).toBe(
      'tts/cast.json',
    )
    expect(readFileSync(join(root, 'tts/cast.json'), 'utf8')).toBe('{ broken')
  })

  it('returns null for a character the project does not have', async () => {
    const root = tempRepo(files)
    expect(await setKeywords(join(root, 'audio-studio.json'), 'nobody', ['x'])).toBeNull()
  })
})

describe('setVoice', () => {
  it('puts the name right after the voice, moving a stray old name', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': {
        speakers: { grandmother: { voiceName: 'Old', style: '[w]', voice: 'cur' } },
      },
    })
    await setVoice(join(root, 'audio-studio.json'), 'grandmother', { id: 'v', name: 'New' })
    const cast = readFileSync(join(root, 'tts/cast.json'), 'utf8')
    expect(cast).toContain('"grandmother": { "style": "[w]", "voice": "v", "voiceName": "New" }')
  })

  it('adds voice and name at the end for a character without a voice', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': { speakers: { grandmother: { voiceName: 'Old', style: '[w]' } } },
    })
    await setVoice(join(root, 'audio-studio.json'), 'grandmother', { id: 'v', name: 'New' })
    const cast = readFileSync(join(root, 'tts/cast.json'), 'utf8')
    expect(cast).toContain('"grandmother": { "style": "[w]", "voice": "v", "voiceName": "New" }')
  })
})

describe('setSpeed', () => {
  it('saves a character’s own speed, and removes it when cleared', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setSpeed(projectFile, 'grandmother', 0.85)).toEqual({ ok: true })
    let cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother).toEqual({
      voice: 'cur',
      style: '[warm]',
      audition: { keywords: ['warm'] },
      speed: 0.85,
    })
    expect(await setSpeed(projectFile, 'grandmother', null)).toEqual({ ok: true })
    cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother).toEqual({
      voice: 'cur',
      style: '[warm]',
      audition: { keywords: ['warm'] },
    })
  })
})

describe('setStyle', () => {
  it('saves a character’s style cue, trimmed, keeping the rest of the entry', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setStyle(projectFile, 'grandmother', '  [tired, kind]  ')).toEqual({ ok: true })
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother).toEqual({
      voice: 'cur',
      style: '[tired, kind]',
      audition: { keywords: ['warm'] },
    })
  })

  it('removes the style when it is cleared', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await setStyle(projectFile, 'grandmother', ' ')
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother).toEqual({ voice: 'cur', audition: { keywords: ['warm'] } })
  })

  it('gives a character not yet in the cast an entry', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setStyle(projectFile, 'tilda', '[bright]')).toEqual({ ok: true })
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.tilda).toEqual({ style: '[bright]' })
  })

  it('knows no unknown character', async () => {
    const root = tempRepo(files)
    expect(await setStyle(join(root, 'audio-studio.json'), 'nobody', '[x]')).toBeNull()
  })
})

describe('setPronunciations', () => {
  const withTable = {
    ...files,
    'tts/cast.json': {
      speakers: { grandmother: { voice: 'cur', style: '[warm]' } },
      pronounce: { 'Act I:': 'Act One:', Eldoria: 'El-door-ia' },
    },
  }
  const was: [string, string][] = [
    ['Act I:', 'Act One:'],
    ['Eldoria', 'El-door-ia'],
  ]

  it('saves the table in the order given, keeping the characters', async () => {
    const root = tempRepo(withTable)
    const table: [string, string][] = [
      ['Eldoria', 'El-dor-ia'],
      ['Act I:', 'Act One:'],
      ['Willowbrook', 'Willow brook'],
    ]
    expect(await setPronunciations(join(root, 'audio-studio.json'), table, was)).toEqual({
      ok: true,
    })
    const text = readFileSync(join(root, 'tts/cast.json'), 'utf8')
    expect(Object.entries(JSON.parse(text).pronounce)).toEqual([
      ['Eldoria', 'El-dor-ia'],
      ['Act I:', 'Act One:'],
      ['Willowbrook', 'Willow brook'],
    ])
    expect(JSON.parse(text).speakers.grandmother).toEqual({ voice: 'cur', style: '[warm]' })
  })

  it('refuses when the table changed since the page showed it', async () => {
    const root = tempRepo(withTable)
    const result = await setPronunciations(
      join(root, 'audio-studio.json'),
      [],
      [['Act I:', 'Act One:']],
    )
    expect(result).toMatchObject({
      ok: false,
      problems: [{ file: 'tts/cast.json', path: 'pronounce' }],
    })
    expect(JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8')).pronounce).toEqual({
      'Act I:': 'Act One:',
      Eldoria: 'El-door-ia',
    })
  })

  it('starts a cast when there is none', async () => {
    const root = tempRepo({ ...files, 'tts/cast.json': undefined })
    const projectFile = join(root, 'audio-studio.json')
    expect(await setPronunciations(projectFile, [['Eldoria', 'El-door-ia']], [])).toEqual({
      ok: true,
    })
    expect(JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))).toEqual({
      speakers: {},
      pronounce: { Eldoria: 'El-door-ia' },
    })
  })

  it('lets the table fix a number key that the character setters refuse to rewrite', async () => {
    const root = tempRepo({
      ...withTable,
      'tts/cast.json': { speakers: {}, pronounce: { Eldoria: 'x', '10': 'ten' } },
    })
    const projectFile = join(root, 'audio-studio.json')
    const shown: [string, string][] = [
      ['10', 'ten'],
      ['Eldoria', 'x'],
    ]
    expect(await setStyle(projectFile, 'grandmother', '[x]')).toMatchObject({ ok: false })
    expect(await setPronunciations(projectFile, shown, shown)).toMatchObject({ ok: false })
    const fixed: [string, string][] = [
      ['Eldoria', 'x'],
      ['Act 10', 'Act ten'],
    ]
    expect(await setPronunciations(projectFile, fixed, shown)).toEqual({ ok: true })
    expect(await setStyle(projectFile, 'grandmother', '[x]')).toEqual({ ok: true })
  })

  it('keeps a character change made at the same time', async () => {
    const root = tempRepo(withTable)
    const projectFile = join(root, 'audio-studio.json')
    await Promise.all([
      setStyle(projectFile, 'grandmother', '[tired]'),
      setPronunciations(projectFile, [['Eldoria', 'El-dor-ia']], was),
    ])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.grandmother.style).toBe('[tired]')
    expect(cast.pronounce).toEqual({ Eldoria: 'El-dor-ia' })
  })

  it('refuses a table with a problem', async () => {
    const root = tempRepo(withTable)
    const result = await setPronunciations(
      join(root, 'audio-studio.json'),
      [['', 'El-door-ia']],
      was,
    )
    expect(result).toMatchObject({ ok: false, problems: [{ path: 'pronounce' }] })
  })
})

describe('casting per language', () => {
  const several = () => {
    const base = projectJson()
    return {
      ...files,
      'audio-studio.json': {
        ...base,
        narration: {
          ...(base.narration as object),
          languages: ['en', 'sv'],
          paths: {
            dialog: 'tts/{part}/{language}/script.json',
            cues: 'tts/{part}/{language}/cues.json',
            lock: 'tts/{part}/{language}/narration.lock.json',
            clips: 'audio/{part}/{language}',
            manifest: 'audio/{part}/{language}/manifest.json',
          },
        },
      },
      'tts/act1/en/script.json': [{ key: 'a', speaker: 'grandmother', text: 'Hello.' }],
    }
  }
  const cast = (root: string) => JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))

  it('casts a voice for one language only, leaving the source language alone', async () => {
    const root = tempRepo(several())
    const projectFile = join(root, 'audio-studio.json')
    expect(
      await setVoice(projectFile, 'grandmother', { id: 'v', name: 'Varm Mormor' }, 'sv'),
    ).toEqual({ ok: true })
    expect(cast(root).speakers.grandmother).toEqual({
      voice: 'cur',
      style: '[warm]',
      audition: { keywords: ['warm'] },
      languages: { sv: { voice: 'v', voiceName: 'Varm Mormor' } },
    })
  })

  it('saves a speed and a phrase for one language, and removes what is cleared', async () => {
    const root = tempRepo(several())
    const projectFile = join(root, 'audio-studio.json')
    await setSpeed(projectFile, 'grandmother', 0.95, 'sv')
    await setPhrase(projectFile, 'grandmother', ' Kom in. ', 'sv')
    expect(cast(root).speakers.grandmother.languages).toEqual({
      sv: { speed: 0.95, phrase: 'Kom in.' },
    })
    expect(cast(root).speakers.grandmother.speed).toBeUndefined()
    await setSpeed(projectFile, 'grandmother', null, 'sv')
    await setPhrase(projectFile, 'grandmother', null, 'sv')
    expect(cast(root).speakers.grandmother.languages).toBeUndefined()
  })

  it('treats a language the project does not declare as the source language', async () => {
    const root = tempRepo(several())
    await setSpeed(join(root, 'audio-studio.json'), 'grandmother', 0.8, 'fr')
    expect(cast(root).speakers.grandmother.speed).toBe(0.8)
  })

  it('names a too-long phrase at its place in the language', async () => {
    const root = tempRepo(several())
    const result = await setPhrase(
      join(root, 'audio-studio.json'),
      'grandmother',
      'x'.repeat(401),
      'sv',
    )
    expect(result).toMatchObject({
      ok: false,
      problems: [{ path: 'speakers.grandmother.languages.sv.phrase' }],
    })
  })
})
