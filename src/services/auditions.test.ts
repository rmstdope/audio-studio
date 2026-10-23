import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Voice } from '../core/voiceSearch'
import { findCandidates, setKeywords } from './auditions'
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
  async listVoices(query) {
    const items = library.filter((v) => v.title.includes(query.title ?? ''))
    return { total: items.length, items }
  },
  async getVoice(id) {
    const found = library.find((v) => v.id === id)
    if (!found) throw new Error('gone')
    return found
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
