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
  recordedLines,
  judge,
  sessionFor,
  startAudition,
} from './sessions'
import { ruledOutIds, ruleOutVoices } from './ruledOut'
import { setKeywords } from './auditions'

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
  async credit() {
    return 25
  },
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
  'tts/cast.json':
    '{\n  "speakers": {\n' +
    '    "mira": { "voice": "cur", "style": "[low]", "audition": { "keywords": ["warm"] } },\n' +
    '    "tilda": { "voice": "t1" }\n' +
    '  },\n  "pronounce": { "Act I:": "Act One:", "Elior": "El-ee-or" }\n}\n',
  'audio/act1/manifest.json': { a1: { file: 'a1.mp3' } },
  'audio/act1/a1.mp3': 'clip',
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
    expect(again).toMatchObject({ ok: false, reason: 'exhausted' })
  })
})

describe('moreVoices, with a large library', () => {
  it('keeps finding new voices beyond the first search, and says when there are none', async () => {
    const many = Array.from({ length: 40 }, (_, i) => voice(`m${i}`, `Warm m${i}`, 1000 - i))
    const big: FishClient = {
      ...fish,
      async listVoices(query) {
        const items = many.filter((v) => v.title.toLowerCase().includes(query.title ?? ''))
        return { total: items.length, items }
      },
      async getVoice() {
        throw new Error('no current voice')
      },
    }
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await startAudition(projectFile, 'mira', async () => big)
    let pool = 0
    for (let i = 0; i < 20; i++) {
      const result = await moreVoices(projectFile, 'mira', async () => big)
      if (!result?.ok) {
        expect(result).toMatchObject({ ok: false, reason: 'exhausted' })
        break
      }
      pool = result.session.pool.length
    }
    expect(pool).toBe(40)
  })
})

describe('moreVoices, keywords', () => {
  it('searches with the keywords the audition started with, even after they change', async () => {
    const { projectFile } = await started()
    await setKeywords(projectFile, 'mira', ['cold'])
    const asked: string[] = []
    const watching: FishClient = {
      ...fish,
      listVoices: (query) => (asked.push(query.title ?? ''), fish.listVoices(query)),
    }
    await moreVoices(projectFile, 'mira', async () => watching)
    await moreVoices(projectFile, 'mira', async () => watching)
    expect(asked.length).toBeGreaterThan(0)
    expect(new Set(asked)).toEqual(new Set(['warm']))
  })
})

describe('addVoiceById', () => {
  it('takes a queued voice from the session, without asking Fish', async () => {
    const { projectFile } = await started()
    const asked: string[] = []
    const watching: FishClient = { ...fish, getVoice: (id) => (asked.push(id), fish.getVoice(id)) }
    const result = await addVoiceById(projectFile, 'mira', 'e', async () => watching)
    expect(result?.ok && result.session.pool.at(-1)).toBe('e')
    expect(asked).toEqual([])
  })

  it('says so when the voice is in the round or was dropped, without asking Fish', async () => {
    const { projectFile } = await started()
    const asked: string[] = []
    const watching: FishClient = { ...fish, getVoice: (id) => (asked.push(id), fish.getVoice(id)) }
    expect(await addVoiceById(projectFile, 'mira', 'a', async () => watching)).toMatchObject({
      ok: false,
      reason: 'seen',
      message: 'That voice is already in this round.',
    })
    await changeSession(projectFile, 'mira', (s) => ({ ...s, verdicts: { a: 'drop' } }))
    await changeSession(projectFile, 'mira', (s) => ({
      ...s,
      round: 2,
      pool: s.pool.filter((v) => v !== 'a'),
      dropped: ['a'],
      verdicts: {},
    }))
    expect(await addVoiceById(projectFile, 'mira', 'a', async () => watching)).toMatchObject({
      ok: false,
      reason: 'seen',
      message: 'That voice was dropped earlier in this audition.',
    })
    expect(asked).toEqual([])
  })

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
  it('writes the last voice left to the cast, says which recorded lines go stale, and ends the audition', async () => {
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
      stale: [{ part: 'act1', lines: 1 }],
    })
    expect(readFileSync(join(root, 'tts/cast.json'), 'utf8')).toBe(
      '{\n  "speakers": {\n' +
        '    "mira": { "voice": "b", "voiceName": "Warm b", "style": "[low]", "audition": { "keywords": ["warm"] } },\n' +
        '    "tilda": { "voice": "t1" }\n' +
        '  },\n  "pronounce": { "Act I:": "Act One:", "Elior": "El-ee-or" }\n}\n',
    )
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

  it('applies a cast queued with a keyword change, keeping both', async () => {
    const { root, projectFile } = await started()
    await changeSession(projectFile, 'mira', (s) => ({
      ...s,
      verdicts: { cur: 'drop', a: 'drop', c: 'drop' },
    }))
    await Promise.all([
      castFinalist(projectFile, 'mira'),
      setKeywords(projectFile, 'mira', ['old']),
    ])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.mira).toMatchObject({ voice: 'b', audition: { keywords: ['old'] } })
  })

  it('refuses while more than one voice is left', async () => {
    const { projectFile } = await started()
    expect(await castFinalist(projectFile, 'mira')).toMatchObject({
      ok: false,
      reason: 'no-finalist',
    })
  })
})

describe('sessionFor, recorded lines', () => {
  it('says how many recorded lines each part has, which a cast would make stale', async () => {
    const { projectFile } = await started()
    expect(await recordedLines(projectFile, 'mira')).toEqual([{ part: 'act1', lines: 1 }])
  })
})

describe('discardSession', () => {
  it('answers an unknown character with null, and a broken project with its problems', async () => {
    const root = tempRepo(files)
    expect(await discardSession(join(root, 'audio-studio.json'), 'nobody')).toBeNull()
    const broken = tempRepo({ ...files, 'audio-studio.json': '{' })
    expect(await discardSession(join(broken, 'audio-studio.json'), 'mira')).toMatchObject({
      ok: false,
      file: 'audio-studio.json',
    })
  })

  it('removes the saved session', async () => {
    const { root, projectFile } = await started()
    await discardSession(projectFile, 'mira')
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
    expect(readdirSync(join(root, '.audio-studio/auditions'))).toEqual([])
    expect(existsSync(join(root, 'tts/cast.json'))).toBe(true)
  })
})

describe('ruled-out voices in an audition', () => {
  it('rules a voice out when it is dropped, and allows it again when the drop is taken back', async () => {
    const { projectFile } = await started()
    const dropped = await judge(projectFile, 'mira', 'a', 'drop')
    expect(dropped?.ok && dropped.session.verdicts).toEqual({ a: 'drop' })
    expect(await ruledOutIds(projectFile, 'mira')).toEqual(['a'])
    await judge(projectFile, 'mira', 'b', 'keep')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual(['a'])
    await judge(projectFile, 'mira', 'a', null)
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('keeps the two files in step when verdicts on a voice are given at once', async () => {
    for (const order of [['drop', null] as const, [null, 'drop'] as const]) {
      const { projectFile } = await started()
      await Promise.all(order.map((verdict) => judge(projectFile, 'mira', 'a', verdict)))
      const saved = await sessionFor(projectFile, 'mira')
      const dropped = saved?.ok && saved.session?.verdicts.a === 'drop'
      expect(await ruledOutIds(projectFile, 'mira')).toEqual(dropped ? ['a'] : [])
    }
  })

  it('never rules out the current voice', async () => {
    const { projectFile } = await started()
    await judge(projectFile, 'mira', 'cur', 'drop')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('rules out nothing for a voice not in the round', async () => {
    const { projectFile } = await started()
    await judge(projectFile, 'mira', 'g', 'drop')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('leaves voices ruled out earlier out of a new audition and of later searches', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await ruleOutVoices(projectFile, 'mira', [
      { id: 'a', title: 'Warm a' },
      { id: 'e', title: 'Warm e' },
    ])
    const result = await startAudition(projectFile, 'mira', fishFor)
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.session.pool).toEqual(['cur', 'b', 'c', 'd'])
    expect(result.session.queue).toEqual(['f', 'g'])
    const more = await moreVoices(projectFile, 'mira', fishFor)
    expect(more?.ok && more.session.pool).toEqual(['cur', 'b', 'c', 'd', 'f', 'g'])
  })

  it('allows a ruled-out voice again when it is brought in by its id', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await ruleOutVoices(projectFile, 'mira', [{ id: 'a', title: 'Warm a' }])
    await startAudition(projectFile, 'mira', fishFor)
    const added = await addVoiceById(projectFile, 'mira', 'a', fishFor)
    expect(added?.ok && added.session.pool.at(-1)).toBe('a')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('keeps a voice dropped in this audition ruled out when it is asked for by id', async () => {
    const { projectFile } = await started()
    await judge(projectFile, 'mira', 'a', 'drop')
    expect(await addVoiceById(projectFile, 'mira', 'a', fishFor)).toMatchObject({ reason: 'seen' })
    expect(await ruledOutIds(projectFile, 'mira')).toEqual(['a'])
  })
})
