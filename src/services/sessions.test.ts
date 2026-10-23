import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Voice } from '../core/voiceSearch'
import type { FishClient } from './fish'
import {
  addVoiceById,
  castFinalist,
  changeSession,
  discardSession,
  moreVoices,
  sessionFor,
  startAudition,
} from './sessions'

function voice(id: string, title = `Warm ${id}`, uses = 10): Voice {
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
  voice('cur', 'Old voice'),
  ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => voice(id, `Warm ${id}`, 100 - i)),
]
const extra = voice('x', 'Someone else')

const fish: FishClient = {
  async listVoices(query) {
    const items = library.filter((v) => v.title.toLowerCase().includes(query.title ?? ''))
    return { total: items.length, items }
  },
  async getVoice(id) {
    const found = [...library, extra].find((v) => v.id === id)
    if (!found) throw new Error('no such voice')
    return found
  },
  async tts() {
    return new Uint8Array([1])
  },
}
const fishFor = async () => fish

const project = projectJson()
;(project.narration as { audition?: unknown }).audition = { candidatesPerRound: 3 }

const files = {
  'audio-studio.json': project,
  'tts/cast.json': {
    speakers: { mira: { voice: 'cur', style: '[low]', audition: { keywords: ['warm'] } } },
    pronounce: {},
  },
  'tts/act1/script.json': [
    { key: 'a1', speaker: 'mira', text: 'Welcome.' },
    { key: 'a2', speaker: 'mira', text: 'Again.' },
  ],
  'tts/act2/script.json': [{ key: 'b1', speaker: 'mira', text: 'Later.' }],
}

async function started() {
  const root = tempRepo(files)
  const projectFile = join(root, 'audio-studio.json')
  const result = await startAudition(projectFile, 'mira', fishFor)
  if (!result?.ok) throw new Error(JSON.stringify(result))
  return { root, projectFile, session: result.session }
}

describe('startAudition', () => {
  it('starts round 1 from the search, with the current voice, and saves it', async () => {
    const { projectFile, session } = await started()
    expect(session.pool).toEqual(['cur', 'a', 'b', 'c'])
    expect(session.queue).toEqual(['d', 'e', 'f', 'g'])
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session })
  })

  it('has no session before one is started', async () => {
    const root = tempRepo(files)
    expect(await sessionFor(join(root, 'audio-studio.json'), 'mira')).toEqual({
      ok: true,
      session: null,
    })
  })
})

describe('changeSession', () => {
  it('applies a change and saves it', async () => {
    const { projectFile } = await started()
    const result = await changeSession(projectFile, 'mira', (s) => ({
      ...s,
      verdicts: { a: 'drop' },
    }))
    expect(result?.ok && result.session.verdicts).toEqual({ a: 'drop' })
    const saved = await sessionFor(projectFile, 'mira')
    expect(saved?.ok && saved.session?.verdicts).toEqual({ a: 'drop' })
  })

  it('applies changes made at once one after the other', async () => {
    const { projectFile } = await started()
    await Promise.all([
      changeSession(projectFile, 'mira', (s) => ({ ...s, verdicts: { ...s.verdicts, a: 'drop' } })),
      changeSession(projectFile, 'mira', (s) => ({ ...s, verdicts: { ...s.verdicts, b: 'keep' } })),
    ])
    const saved = await sessionFor(projectFile, 'mira')
    expect(saved?.ok && saved.session?.verdicts).toEqual({ a: 'drop', b: 'keep' })
  })

  it('says so when there is no session', async () => {
    const root = tempRepo(files)
    expect(await changeSession(join(root, 'audio-studio.json'), 'mira', (s) => s)).toEqual({
      ok: false,
      reason: 'no-session',
      message: 'There is no audition for mira; start one.',
    })
  })
})

describe('moreVoices', () => {
  it('brings in a round’s worth from the queue', async () => {
    const { projectFile } = await started()
    const result = await moreVoices(projectFile, 'mira', fishFor)
    expect(result?.ok && result.session.pool).toEqual(['cur', 'a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('searches again when the queue runs out, never bringing back a seen voice', async () => {
    const { projectFile } = await started()
    await moreVoices(projectFile, 'mira', fishFor)
    const result = await moreVoices(projectFile, 'mira', fishFor)
    expect(result?.ok && result.session.pool).toEqual(['cur', 'a', 'b', 'c', 'd', 'e', 'f', 'g'])
    const again = await moreVoices(projectFile, 'mira', fishFor)
    expect(again?.ok && again.session.pool.length).toBe(8)
  })
})

describe('addVoiceById', () => {
  it('adds a voice from Fish by its id', async () => {
    const { projectFile } = await started()
    const result = await addVoiceById(projectFile, 'mira', 'x', fishFor)
    expect(result?.ok && result.session.pool.at(-1)).toBe('x')
  })

  it('says what Fish said when the voice does not exist', async () => {
    const { projectFile } = await started()
    expect(await addVoiceById(projectFile, 'mira', 'nope', fishFor)).toEqual({
      ok: false,
      reason: 'fish',
      message: 'no such voice',
    })
  })
})

describe('castFinalist', () => {
  it('writes the last voice left to the cast, says which lines go stale, and ends the audition', async () => {
    const { root, projectFile } = await started()
    await changeSession(projectFile, 'mira', (s) => ({
      ...s,
      verdicts: { cur: 'drop', a: 'drop', c: 'drop' },
    }))
    const result = await castFinalist(projectFile, 'mira')
    expect(result).toEqual({
      ok: true,
      voice: { id: 'b', name: 'Warm b' },
      changed: true,
      stale: [
        { part: 'act1', lines: 2 },
        { part: 'act2', lines: 1 },
      ],
    })
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.mira).toEqual({
      voice: 'b',
      style: '[low]',
      audition: { keywords: ['warm'] },
      voiceName: 'Warm b',
    })
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
  })

  it('changes nothing when the current voice wins', async () => {
    const { projectFile } = await started()
    await changeSession(projectFile, 'mira', (s) => ({
      ...s,
      verdicts: { a: 'drop', b: 'drop', c: 'drop' },
    }))
    const result = await castFinalist(projectFile, 'mira')
    expect(result).toMatchObject({ ok: true, voice: { id: 'cur' }, changed: false, stale: [] })
  })

  it('refuses while more than one voice is left', async () => {
    const { projectFile } = await started()
    expect(await castFinalist(projectFile, 'mira')).toMatchObject({
      ok: false,
      reason: 'no-finalist',
    })
  })
})

describe('discardSession', () => {
  it('removes the saved session', async () => {
    const { root, projectFile } = await started()
    await discardSession(projectFile, 'mira')
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
    expect(readdirSync(join(root, '.audio-studio/auditions'))).toEqual([])
    expect(existsSync(join(root, 'tts/cast.json'))).toBe(true)
  })
})
