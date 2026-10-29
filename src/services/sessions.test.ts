import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { elevenVoiceOf, fakeEleven, projectJson, tempRepo } from '../../test/helpers'
import type { Voice } from '../core/voiceSearch'
import { NO_ELEVENLABS_KEY } from './elevenlabs'
import type { FishClient } from './fish'
import {
  addVoiceById,
  auditionMoney,
  recordSpent,
  castOwnVoice,
  castVoice,
  changeSession,
  discardSession,
  moreVoices,
  moveVoice,
  refreshOwnVoices,
  recordedLines,
  sessionFor,
  startAudition,
  undoLastDrop,
  viewOf,
  voicesInUse,
  voicesRemoved,
} from './sessions'
import { ruledOutIds, updateRuledOut } from './ruledOut'
import { setKeywords } from './auditions'
import { createLimiter } from './limit'
import { recordTake } from './takes'

/** Rules voices out, as a drop does. */
const ruleOutVoices = (
  projectFile: string,
  characterId: string,
  voices: { id: string; title: string }[],
  at?: Date,
) => updateRuledOut(projectFile, characterId, { out: voices }, at)

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

let ownVoices: Voice[] = []
const fish: FishClient = {
  async listOwnVoices() {
    return ownVoices
  },
  createVoice: () => Promise.reject(new Error('not used')),
  designVoice: () => Promise.reject(new Error('not used')),
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

/** An audition just started, then Bring in more pressed once: a, b, c to hear and d to g queued. */
async function started() {
  const { root, projectFile } = await startedEmpty()
  const result = await moreVoices(projectFile, 'mira', fishFor)
  if (!result?.ok) throw new Error(JSON.stringify(result))
  return { root, projectFile, session: result.session }
}

/** An audition just started: nothing to hear. */
async function startedEmpty() {
  const root = tempRepo(files)
  const projectFile = join(root, 'audio-studio.json')
  const result = await startAudition(projectFile, 'mira', fishFor)
  if (!result?.ok) throw new Error(JSON.stringify(result))
  return { root, projectFile, session: result.session }
}

describe('startAudition', () => {
  it('starts with the current voice on the shortlist and nothing to hear, and saves it', async () => {
    const { projectFile, session } = await startedEmpty()
    expect(session.shortlist).toEqual(['cur'])
    expect(session.toHear).toEqual([])
    expect(session.queue).toEqual([])
    expect(session.heard).toBe(false)
    expect(session.keywords).toEqual(['warm'])
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session })
  })

  it('does not search Fish to start, and Bring in more searches afterwards', async () => {
    const searched: unknown[] = []
    const watching: FishClient = {
      ...fish,
      listVoices: (query) => (searched.push(query), fish.listVoices(query)),
    }
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await startAudition(projectFile, 'mira', async () => watching)
    expect(searched).toEqual([])
    const more = await moreVoices(projectFile, 'mira', async () => watching)
    expect(more?.ok && more.session.toHear).toEqual(['a', 'b', 'c'])
    expect(searched.length).toBeGreaterThan(0)
  })

  it('has no session before one is started', async () => {
    const root = tempRepo(files)
    expect(await sessionFor(join(root, 'audio-studio.json'), 'mira')).toEqual({
      ok: true,
      session: null,
    })
  })

  it('takes an audition saved in rounds, before the shortlist, for none', async () => {
    const { root, projectFile } = await started()
    const [file] = readdirSync(join(root, '.audio-studio/auditions'))
    const path = join(root, '.audio-studio/auditions', file!)
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), version: 1 }))
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
  })
})

describe('startAudition, with only an ElevenLabs key', () => {
  it('starts without Fish, and brings voices in from ElevenLabs', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const noFish = async () => null
    const { client } = fakeEleven()
    client.sharedVoices = async () => ({
      voices: [{ ...voice('eleven:l1', 'Warm l1'), library: { owner: 'o', added: false } }],
      more: false,
    })
    const elevenFor = async () => client
    const result = await startAudition(projectFile, 'mira', noFish, undefined, elevenFor)
    if (!result?.ok) throw new Error(JSON.stringify(result))
    // Fish cannot be asked about the cast voice, so it is shown by its id.
    expect(result.session.shortlist).toEqual(['cur'])
    expect(result.session.toHear).toEqual([])
    const more = await moreVoices(projectFile, 'mira', noFish, undefined, {
      provider: 'elevenlabs',
      elevenFor,
    })
    expect(more?.ok && more.session.toHear).toEqual(['eleven:l1'])
  })
})

describe('startAudition, for a character cast with an ElevenLabs voice', () => {
  it('shows its voice as ElevenLabs knows it, and asks Fish nothing about it', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': {
        speakers: { mira: { voice: 'eleven:g1', audition: { keywords: ['warm'] } } },
        pronounce: {},
      },
    })
    const askedFish: string[] = []
    const watching: FishClient = {
      ...fish,
      getVoice: (id) => (askedFish.push(id), fish.getVoice(id)),
    }
    const { client, asked } = fakeEleven({ g1: elevenVoiceOf('g1') })
    const result = await startAudition(
      join(root, 'audio-studio.json'),
      'mira',
      async () => watching,
      undefined,
      async () => client,
    )
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.session.shortlist).toEqual(['eleven:g1'])
    expect(result.session.voices['eleven:g1']).toEqual(elevenVoiceOf('g1'))
    expect(asked).toEqual(['g1'])
    expect(askedFish).toEqual([])
  })

  it('asks Fish nothing about it without an ElevenLabs client either', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': {
        speakers: { mira: { voice: 'eleven:g1', audition: { keywords: ['warm'] } } },
        pronounce: {},
      },
    })
    const askedFish: string[] = []
    const watching: FishClient = {
      ...fish,
      getVoice: (id) => (askedFish.push(id), fish.getVoice(id)),
    }
    const result = await startAudition(
      join(root, 'audio-studio.json'),
      'mira',
      async () => watching,
    )
    expect(result?.ok && result.session.shortlist).toEqual(['eleven:g1'])
    expect(askedFish).toEqual([])
  })
})

describe('changeSession', () => {
  it('applies a change and saves it', async () => {
    const { projectFile } = await started()
    const result = await changeSession(projectFile, 'mira', (s) => ({ ...s, toHear: ['b'] }))
    expect(result?.ok && result.session.toHear).toEqual(['b'])
    const saved = await sessionFor(projectFile, 'mira')
    expect(saved?.ok && saved.session?.toHear).toEqual(['b'])
  })

  it('applies changes made at once one after the other', async () => {
    const { projectFile } = await started()
    await Promise.all([
      moveVoice(projectFile, 'mira', 'a', 'shortlist'),
      moveVoice(projectFile, 'mira', 'b', 'shortlist'),
    ])
    const saved = await sessionFor(projectFile, 'mira')
    expect(saved?.ok && saved.session?.shortlist).toEqual(['cur', 'a', 'b'])
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

describe('moveVoice', () => {
  it('shortlists, unlists and drops a voice', async () => {
    const { projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'a', 'shortlist')
    await moveVoice(projectFile, 'mira', 'cur', 'unlist')
    const result = await moveVoice(projectFile, 'mira', 'b', 'drop')
    expect(result?.ok && [result.session.shortlist, result.session.toHear]).toEqual([
      ['a'],
      ['cur', 'c'],
    ])
  })
})

describe('moreVoices', () => {
  it('brings in a round’s worth from the queue', async () => {
    const { projectFile } = await started()
    const result = await moreVoices(projectFile, 'mira', fishFor)
    expect(result?.ok && result.session.toHear).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('searches again when the queue runs out, never bringing back a seen voice', async () => {
    const { projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'a', 'drop')
    await moreVoices(projectFile, 'mira', fishFor)
    const result = await moreVoices(projectFile, 'mira', fishFor)
    expect(result?.ok && result.session.toHear).toEqual(['b', 'c', 'd', 'e', 'f', 'g'])
    const again = await moreVoices(projectFile, 'mira', fishFor)
    expect(again).toMatchObject({ ok: false, reason: 'exhausted' })
  })
})

describe('moreVoices from ElevenLabs’ library', () => {
  /** A library voice, warm, popular by `uses`. */
  const shared = (id: string, uses: number): Voice => ({
    ...voice(`eleven:${id}`, `Warm ${id}`, uses),
    library: { owner: 'o', added: false },
  })

  it('brings a round’s worth of the best library voices in to hear, leaving Fish’s queue', async () => {
    const { projectFile, session } = await started()
    const { client } = fakeEleven()
    const asked: string[] = []
    client.sharedVoices = async (query) => {
      asked.push(`${query.search}/${query.language}`)
      return {
        voices: [shared('l1', 5), shared('l2', 50), shared('l3', 9), shared('l4', 1)],
        more: false,
      }
    }
    await ruleOutVoices(projectFile, 'mira', [{ id: 'eleven:l3', title: 'Warm l3' }])
    const result = await moreVoices(projectFile, 'mira', fishFor, undefined, {
      provider: 'elevenlabs',
      elevenFor: async () => client,
    })
    expect(result?.ok && result.session.toHear).toEqual([
      ...session.toHear,
      'eleven:l2',
      'eleven:l1',
      'eleven:l4',
    ])
    expect(result?.ok && result.session.queue).toEqual(session.queue)
    expect(result?.ok && result.session.voices['eleven:l2']?.library).toEqual({
      owner: 'o',
      added: false,
    })
    expect(asked).toEqual(['warm/en'])
    const again = await moreVoices(projectFile, 'mira', fishFor, undefined, {
      provider: 'elevenlabs',
      elevenFor: async () => client,
    })
    expect(again).toMatchObject({ ok: false, reason: 'exhausted' })
  })

  it('leaves out a library voice the studio added that is cast or on the board as its own id', async () => {
    const { root, projectFile } = await started()
    writeFileSync(
      join(root, '.audio-studio/eleven-voices.json'),
      JSON.stringify({
        version: 1,
        added: [
          { library: 'eleven:l1', voice: 'cur', name: 'Old', character: 'mira', at: '' },
          { library: 'eleven:l2', voice: 'eleven:gone', name: 'Gone', character: 'x', at: '' },
        ],
      }),
    )
    const { client } = fakeEleven()
    client.sharedVoices = async () => ({ voices: [shared('l1', 50), shared('l2', 5)], more: false })
    const result = await moreVoices(projectFile, 'mira', fishFor, undefined, {
      provider: 'elevenlabs',
      elevenFor: async () => client,
    })
    expect(result?.ok && result.session.toHear.filter((id) => id.startsWith('eleven:'))).toEqual([
      'eleven:l2',
    ])
  })

  it('says so without a key, or when ElevenLabs refuses', async () => {
    const { projectFile } = await started()
    expect(
      await moreVoices(projectFile, 'mira', fishFor, undefined, {
        provider: 'elevenlabs',
        elevenFor: async () => null,
      }),
    ).toEqual({ ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY })
    const { client } = fakeEleven()
    client.sharedVoices = () => Promise.reject(new Error('ElevenLabs answered 401: bad key'))
    expect(
      await moreVoices(projectFile, 'mira', fishFor, undefined, {
        provider: 'elevenlabs',
        elevenFor: async () => client,
      }),
    ).toEqual({ ok: false, reason: 'elevenlabs', message: 'ElevenLabs answered 401: bad key' })
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
    let shown = 0
    for (let i = 0; i < 20; i++) {
      const result = await moreVoices(projectFile, 'mira', async () => big)
      if (!result?.ok) {
        expect(result).toMatchObject({ ok: false, reason: 'exhausted' })
        break
      }
      shown = result.session.toHear.length
    }
    expect(shown).toBe(40)
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
    expect(result?.ok && result.session.toHear[0]).toBe('e')
    expect(asked).toEqual([])
  })

  it('says so when the voice is in the audition already, without asking Fish', async () => {
    const { projectFile } = await started()
    const asked: string[] = []
    const watching: FishClient = { ...fish, getVoice: (id) => (asked.push(id), fish.getVoice(id)) }
    for (const id of ['a', 'cur']) {
      expect(await addVoiceById(projectFile, 'mira', id, async () => watching)).toMatchObject({
        ok: false,
        reason: 'seen',
        message: 'That voice is in this audition already.',
      })
    }
    expect(asked).toEqual([])
  })

  it('adds a voice from Fish by its id', async () => {
    const { projectFile } = await started()
    const result = await addVoiceById(projectFile, 'mira', 'x', fishFor)
    expect(result?.ok && result.session.toHear[0]).toBe('x')
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

describe('addVoiceById, an ElevenLabs voice', () => {
  const george = { g1: elevenVoiceOf('g1') }
  const noFish = async () => {
    throw new Error('Fish is not asked about an ElevenLabs voice')
  }

  it('looks it up on ElevenLabs by its own id, and asks Fish nothing', async () => {
    const { projectFile } = await started()
    const { client, asked } = fakeEleven(george)
    const result = await addVoiceById(
      projectFile,
      'mira',
      'eleven:g1',
      noFish,
      undefined,
      async () => client,
    )
    expect(result?.ok && result.session.toHear[0]).toBe('eleven:g1')
    expect(result?.ok && result.session.voices['eleven:g1']?.title).toBe('George')
    expect(asked).toEqual(['g1'])
  })

  it('says to set the key when there is none, and what ElevenLabs said when it refuses', async () => {
    const { projectFile } = await started()
    expect(
      await addVoiceById(projectFile, 'mira', 'eleven:g1', noFish, undefined, async () => null),
    ).toEqual({ ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY })
    expect(await addVoiceById(projectFile, 'mira', 'eleven:g1', noFish)).toMatchObject({
      reason: 'no-key',
    })
    const { client } = fakeEleven(george)
    expect(
      await addVoiceById(projectFile, 'mira', 'eleven:nope', noFish, undefined, async () => client),
    ).toEqual({
      ok: false,
      reason: 'elevenlabs',
      message: 'ElevenLabs answered 404: A voice with the voice_id was not found.',
    })
  })
})

describe('castOwnVoice', () => {
  const own = { id: 'mine', name: 'My Mira' }

  it('casts a voice no audition holds, and says which recorded lines go stale', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const result = await castOwnVoice(projectFile, 'mira', own)
    expect(result).toEqual({
      ok: true,
      voice: own,
      changed: true,
      stale: [{ part: 'act1', lines: 1 }],
    })
    expect(
      JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8')).speakers.mira,
    ).toMatchObject({
      voice: 'mine',
      voiceName: 'My Mira',
      style: '[low]',
    })
  })

  it('ends an audition going on, as casting does', async () => {
    const { projectFile } = await started()
    await castOwnVoice(projectFile, 'mira', own)
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
  })

  it('changes nothing for the voice already cast', async () => {
    const projectFile = join(tempRepo(files), 'audio-studio.json')
    expect(await castOwnVoice(projectFile, 'mira', { id: 'cur', name: 'Old' })).toMatchObject({
      ok: true,
      changed: false,
      stale: [],
    })
  })

  it('says when the project will not load', async () => {
    const projectFile = join(tempRepo({ 'audio-studio.json': '{' }), 'audio-studio.json')
    expect(await castOwnVoice(projectFile, 'mira', own)).toMatchObject({ ok: false })
  })

  it('knows no character it was not asked about', async () => {
    const projectFile = join(tempRepo(files), 'audio-studio.json')
    expect(await castOwnVoice(projectFile, 'nobody', own)).toBeNull()
  })
})

describe('castVoice', () => {
  it('writes a shortlisted voice to the cast, says which recorded lines go stale, and ends the audition', async () => {
    const { root, projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'b', 'shortlist')
    const result = await castVoice(projectFile, 'mira', 'b')
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

  it('casts a library voice as the voice `saveAs` gives, and nothing when it cannot be added', async () => {
    const { projectFile } = await started()
    const { client } = fakeEleven()
    client.sharedVoices = async () => ({
      voices: [{ ...voice('eleven:l1', 'Warm l1'), library: { owner: 'o', added: false } }],
      more: false,
    })
    await moreVoices(projectFile, 'mira', fishFor, undefined, {
      provider: 'elevenlabs',
      elevenFor: async () => client,
    })
    await moveVoice(projectFile, 'mira', 'eleven:l1', 'shortlist')
    const refused = await castVoice(projectFile, 'mira', 'eleven:l1', undefined, async () => {
      throw new Error('ElevenLabs answered 400: You have reached your voice limit.')
    })
    expect(refused).toEqual({
      ok: false,
      reason: 'save',
      voice: 'eleven:l1',
      message: 'ElevenLabs answered 400: You have reached your voice limit.',
    })
    expect((await sessionFor(projectFile, 'mira'))?.ok).toBe(true)
    const saved: string[] = []
    const result = await castVoice(projectFile, 'mira', 'eleven:l1', undefined, async (v) => {
      saved.push(v.id)
      return 'eleven:own1'
    })
    expect(result).toMatchObject({ ok: true, voice: { id: 'eleven:own1', name: 'Warm l1' } })
    expect(saved).toEqual(['eleven:l1'])
  })

  it('asks `saveAs` nothing for a voice not of the library', async () => {
    const { projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'b', 'shortlist')
    const result = await castVoice(projectFile, 'mira', 'b', undefined, async () => {
      throw new Error('asked')
    })
    expect(result).toMatchObject({ ok: true, voice: { id: 'b' } })
  })

  it('changes nothing when the current voice is kept', async () => {
    const { projectFile } = await started()
    const result = await castVoice(projectFile, 'mira', 'cur')
    expect(result).toMatchObject({ ok: true, voice: { id: 'cur' }, changed: false, stale: [] })
  })

  it('applies a cast queued with a keyword change, keeping both', async () => {
    const { root, projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'b', 'shortlist')
    await Promise.all([
      castVoice(projectFile, 'mira', 'b'),
      setKeywords(projectFile, 'mira', ['old']),
    ])
    const cast = JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))
    expect(cast.speakers.mira).toMatchObject({ voice: 'b', audition: { keywords: ['old'] } })
  })

  it('refuses a voice not on the shortlist', async () => {
    const { projectFile } = await started()
    expect(await castVoice(projectFile, 'mira', 'a')).toMatchObject({
      ok: false,
      reason: 'not-shortlisted',
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

  it('removes the saved session, leaving the voices dropped ruled out', async () => {
    const { root, projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'a', 'drop')
    await discardSession(projectFile, 'mira')
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
    expect(readdirSync(join(root, '.audio-studio/auditions'))).toEqual([])
    expect(existsSync(join(root, 'tts/cast.json'))).toBe(true)
    expect(await ruledOutIds(projectFile, 'mira')).toEqual(['a'])
  })
})

describe('ruled-out voices in an audition', () => {
  it('rules a voice out when it is dropped, and allows it again when the drop is undone', async () => {
    const { projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'a', 'shortlist')
    await moveVoice(projectFile, 'mira', 'a', 'drop')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual(['a'])
    const undone = await undoLastDrop(projectFile, 'mira')
    expect(undone?.ok && undone.session.shortlist).toEqual(['a', 'cur'])
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('keeps the two files in step when a drop and its undo are asked for at once', async () => {
    const { projectFile } = await started()
    await Promise.all([
      moveVoice(projectFile, 'mira', 'a', 'drop'),
      undoLastDrop(projectFile, 'mira'),
    ])
    const saved = await sessionFor(projectFile, 'mira')
    const dropped = saved?.ok && saved.session?.dropped.some((d) => d.id === 'a')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual(dropped ? ['a'] : [])
  })

  it('changes nothing when the ruled-out voices cannot be saved', async () => {
    const { root, projectFile } = await started()
    writeFileSync(join(root, '.audio-studio/ruled-out'), 'in the way')
    await expect(moveVoice(projectFile, 'mira', 'a', 'drop')).rejects.toThrow()
    const saved = await sessionFor(projectFile, 'mira')
    expect(saved?.ok && saved.session?.toHear).toEqual(['a', 'b', 'c'])
  })

  it('never rules out the current voice, though it can be dropped', async () => {
    const { projectFile } = await started()
    const result = await moveVoice(projectFile, 'mira', 'cur', 'drop')
    expect(result?.ok && result.session.shortlist).toEqual([])
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('knows the cast voice when Fish cannot look it up, and never rules it out', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const forgetful: FishClient = {
      ...fish,
      getVoice: (id) => (id === 'cur' ? Promise.reject(new Error('busy')) : fish.getVoice(id)),
    }
    const result = await startAudition(projectFile, 'mira', async () => forgetful)
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.session.current).toBe('cur')
    expect(result.session.shortlist).toEqual(['cur'])
    expect(result.session.voices.cur?.id).toBe('cur')
    await moveVoice(projectFile, 'mira', 'cur', 'drop')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('brings back a dropped voice without asking Fish', async () => {
    const { projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'a', 'drop')
    const noFish = async () => null
    const back = await addVoiceById(projectFile, 'mira', 'a', noFish)
    expect(back?.ok && back.session.toHear[0]).toBe('a')
  })

  it('rules out nothing for a voice not on the board', async () => {
    const { projectFile } = await started()
    await moveVoice(projectFile, 'mira', 'g', 'drop')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })

  it('leaves voices ruled out earlier out of a new audition and of later searches', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await ruleOutVoices(projectFile, 'mira', [
      { id: 'a', title: 'Warm a' },
      { id: 'e', title: 'Warm e' },
    ])
    await startAudition(projectFile, 'mira', fishFor)
    const first = await moreVoices(projectFile, 'mira', fishFor)
    if (!first?.ok) throw new Error(JSON.stringify(first))
    expect(first.session.toHear).toEqual(['b', 'c', 'd'])
    expect(first.session.queue).toEqual(['f', 'g'])
    const more = await moreVoices(projectFile, 'mira', fishFor)
    expect(more?.ok && more.session.toHear).toEqual(['b', 'c', 'd', 'f', 'g'])
  })

  it('allows a ruled-out voice again when it is brought in by its id, also one dropped in this audition', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await ruleOutVoices(projectFile, 'mira', [{ id: 'a', title: 'Warm a' }])
    await startAudition(projectFile, 'mira', fishFor)
    const added = await addVoiceById(projectFile, 'mira', 'a', fishFor)
    expect(added?.ok && added.session.toHear[0]).toBe('a')
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
    await moveVoice(projectFile, 'mira', 'b', 'drop')
    const again = await addVoiceById(projectFile, 'mira', 'b', fishFor)
    expect(again?.ok && [again.session.toHear[0], again.session.dropped]).toEqual(['b', []])
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
  })
})

describe('the money of an audition', () => {
  const paidFiles = {
    ...files,
    'audio-studio.json': {
      ...project,
      narration: { ...(project.narration as object), models: { audition: 's2.1-pro' } },
    },
  }

  it('prices a take of the phrase on the audition model; a free model costs nothing', async () => {
    const paid = join(tempRepo(paidFiles), 'audio-studio.json')
    const money = await auditionMoney(paid, 'mira')
    if (!money?.ok) throw new Error(JSON.stringify(money))
    expect(money.model).toBe('s2.1-pro')
    expect(money.perTake).toBeGreaterThan(0)
    expect(money.spentBefore).toBe(0)
    const free = await auditionMoney(join(tempRepo(files), 'audio-studio.json'), 'mira')
    expect(free).toMatchObject({ ok: true, model: 's2.1-pro-free', perTake: 0 })
  })

  it('prices an ElevenLabs take of the phrase in credits on ElevenLabs’ audition model', async () => {
    const money = await auditionMoney(join(tempRepo(files), 'audio-studio.json'), 'mira')
    if (!money?.ok) throw new Error(JSON.stringify(money))
    expect(money.eleven.model).toBe('eleven_v3')
    // A credit a character of the phrase as sent, with mira's style.
    expect(money.eleven.perTake).toBeGreaterThan(10)
  })

  it('keeps what takes were charged in the saved audition, across sittings', async () => {
    const projectFile = join(tempRepo(paidFiles), 'audio-studio.json')
    await startAudition(projectFile, 'mira', fishFor)
    await recordSpent(projectFile, 'mira', 0.01)
    await recordSpent(projectFile, 'mira', 0.02)
    const money = await auditionMoney(projectFile, 'mira')
    expect(money?.ok && money.spentBefore).toBeCloseTo(0.03, 12)
  })

  it('says whether the character has an audition going on', async () => {
    const projectFile = join(tempRepo(files), 'audio-studio.json')
    expect(await auditionMoney(projectFile, 'mira')).toMatchObject({ going: false })
    await startAudition(projectFile, 'mira', fishFor)
    expect(await auditionMoney(projectFile, 'mira')).toMatchObject({ going: true })
  })

  it('is null for an unknown character, and records nothing without an audition', async () => {
    const projectFile = join(tempRepo(paidFiles), 'audio-studio.json')
    expect(await auditionMoney(projectFile, 'nobody')).toBeNull()
    await recordSpent(projectFile, 'mira', 0.01)
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
  })
})

describe('refreshOwnVoices', () => {
  const mine = (id: string): Voice => ({ ...voice(id, `Clone ${id}`), own: true })

  it('fills Your voices from the account, and picks up a voice made since on resume', async () => {
    ownVoices = [mine('m1')]
    const { projectFile } = await started()
    const first = await refreshOwnVoices(projectFile, 'mira', fishFor)
    expect(first?.ok && first.session.yours).toEqual(['m1'])
    const kept = await sessionFor(projectFile, 'mira')
    expect(kept?.ok && kept.session?.voices.m1?.own).toBe(true)
    ownVoices = [mine('m1'), mine('m2')]
    const again = await refreshOwnVoices(projectFile, 'mira', fishFor)
    expect(again?.ok && again.session.yours).toEqual(['m1', 'm2'])
    const saved = await sessionFor(projectFile, 'mira')
    expect(saved?.ok && saved.session?.yours).toEqual(['m1', 'm2'])
    ownVoices = []
  })

  it('shows the take of an own voice with the board', async () => {
    ownVoices = [mine('m1')]
    const { projectFile } = await started()
    const result = await refreshOwnVoices(projectFile, 'mira', fishFor)
    await recordTake(projectFile, 'mira', 'm1', fishFor, createLimiter())
    const view = await viewOf(projectFile, 'mira', result!)
    expect(view.ok && Object.keys(view.takes)).toEqual(['m1'])
    ownVoices = []
  })

  it('does not bring back an own voice ruled out for the character', async () => {
    ownVoices = [mine('m1'), mine('m2')]
    const { projectFile } = await started()
    await ruleOutVoices(projectFile, 'mira', [{ id: 'm1', title: 'Clone m1' }])
    const result = await refreshOwnVoices(projectFile, 'mira', fishFor)
    expect(result?.ok && result.session.yours).toEqual(['m2'])
    ownVoices = []
  })

  it('drops an own voice like any other: ruled out, and undone', async () => {
    ownVoices = [mine('m1')]
    const { projectFile } = await started()
    await refreshOwnVoices(projectFile, 'mira', fishFor)
    const dropped = await moveVoice(projectFile, 'mira', 'm1', 'drop')
    expect(dropped?.ok && dropped.session.yours).toEqual([])
    expect(await ruledOutIds(projectFile, 'mira')).toEqual(['m1'])
    const undone = await undoLastDrop(projectFile, 'mira')
    expect(undone?.ok && undone.session.yours).toEqual(['m1'])
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
    ownVoices = []
  })

  it('says why Fish would not list them, and leaves the session as it was', async () => {
    const { projectFile, session } = await started()
    const failing = async () => ({
      ...fish,
      listOwnVoices: () => Promise.reject(new Error('down')),
    })
    const result = await refreshOwnVoices(projectFile, 'mira', failing)
    expect(result).toMatchObject({ ok: false, reason: 'fish', message: 'down' })
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session })
  })

  it('has no session to fill before an audition is started', async () => {
    const root = tempRepo(files)
    const result = await refreshOwnVoices(join(root, 'audio-studio.json'), 'mira', fishFor)
    expect(result).toMatchObject({ ok: false, reason: 'no-session' })
  })
})

describe('an audition per language', () => {
  const base = projectJson()
  const several = {
    ...files,
    'audio-studio.json': {
      ...base,
      narration: {
        ...(base.narration as object),
        languages: ['en', 'sv'],
        audition: { candidatesPerRound: 3 },
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/narration.lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
      },
    },
    'tts/act1/script.json': undefined,
    'tts/act2/script.json': undefined,
    'audio/act1/manifest.json': undefined,
    'audio/act1/a1.mp3': undefined,
    'tts/act1/en/script.json': [{ key: 'a1', speaker: 'mira', text: 'Welcome.' }],
    'tts/act1/sv/script.json': [
      { key: 'a1', speaker: 'mira', text: 'Välkommen.' },
      { key: 'a2', speaker: 'mira', text: 'Igen och igen.' },
    ],
    'audio/act1/sv/manifest.json': { a1: { file: 'a1.mp3' }, a2: { file: 'a2.mp3' } },
    'audio/act1/sv/a1.mp3': 'clip',
    'audio/act1/sv/a2.mp3': 'clip',
  }
  const begin = async (language = 'sv') => {
    const root = tempRepo(several)
    const projectFile = join(root, 'audio-studio.json')
    const first = await startAudition(projectFile, 'mira', fishFor, language)
    if (!first?.ok) throw new Error(JSON.stringify(first))
    const result = await moreVoices(projectFile, 'mira', fishFor, language)
    if (!result?.ok) throw new Error(JSON.stringify(result))
    return { root, projectFile, session: result.session }
  }
  const castFile = (root: string) => JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))

  it('counts the voices on an audition in another language as in use', async () => {
    const { projectFile, session } = await begin()
    const used = await voicesInUse(projectFile)
    expect(session.toHear.every((id) => used?.has(id))).toBe(true)
  })

  it('starts with her voice in another language on the shortlist, when she has none in this one', async () => {
    const { projectFile, session } = await begin()
    expect(session.current).toBeNull()
    expect(session.shortlist).toEqual(['cur'])
    expect(session.toHear).toEqual(['a', 'b', 'c'])
    expect(await sessionFor(projectFile, 'mira', 'sv')).toEqual({ ok: true, session })
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
  })

  it('keeps one audition for each language, so one can wait while another is started', async () => {
    const { projectFile } = await begin()
    const en = await startAudition(projectFile, 'mira', fishFor)
    expect(en?.ok && en.session.current).toBe('cur')
    await moveVoice(projectFile, 'mira', 'a', 'shortlist', 'sv')
    const sv = await sessionFor(projectFile, 'mira', 'sv')
    const english = await sessionFor(projectFile, 'mira')
    expect(sv?.ok && sv.session?.shortlist).toEqual(['cur', 'a'])
    expect(english?.ok && english.session?.shortlist).toEqual(['cur'])
  })

  it('rules a dropped voice out in this language only', async () => {
    const { projectFile } = await begin()
    await moveVoice(projectFile, 'mira', 'a', 'drop', 'sv')
    expect(await ruledOutIds(projectFile, 'mira', 'sv')).toEqual(['a'])
    expect(await ruledOutIds(projectFile, 'mira')).toEqual([])
    await undoLastDrop(projectFile, 'mira', 'sv')
    expect(await ruledOutIds(projectFile, 'mira', 'sv')).toEqual([])
  })

  it('shows the language’s phrase and the lines casting would make stale in it', async () => {
    const { projectFile } = await begin()
    const result = await sessionFor(projectFile, 'mira', 'sv')
    const view = await viewOf(projectFile, 'mira', result!, { language: 'sv' })
    expect(view).toMatchObject({
      ok: true,
      audition: { phrase: 'Igen och igen.', from: 'line' },
      recorded: [{ part: 'act1', lines: 2 }],
    })
    expect(await recordedLines(projectFile, 'mira')).toEqual([])
    expect(await recordedLines(projectFile, 'mira', 'sv')).toEqual([{ part: 'act1', lines: 2 }])
  })

  it('casts for this language only: its voice is added, English is left, and only its lines go stale', async () => {
    const { root, projectFile } = await begin()
    await moveVoice(projectFile, 'mira', 'b', 'shortlist', 'sv')
    const result = await castVoice(projectFile, 'mira', 'b', 'sv')
    expect(result).toEqual({
      ok: true,
      voice: { id: 'b', name: 'Warm b' },
      changed: true,
      stale: [{ part: 'act1', lines: 2 }],
    })
    expect(castFile(root).speakers.mira).toMatchObject({
      voice: 'cur',
      languages: { sv: { voice: 'b', voiceName: 'Warm b' } },
    })
    expect(await sessionFor(projectFile, 'mira', 'sv')).toEqual({ ok: true, session: null })
  })

  it('casts one of her voices from another language, once it has been heard saying this language’s phrase', async () => {
    const { projectFile } = await begin()
    const result = await castVoice(projectFile, 'mira', 'cur', 'sv')
    expect(result).toMatchObject({ ok: true, changed: true })
  })

  it('does not start without a phrase to say, and says why', async () => {
    const root = tempRepo({
      ...several,
      'tts/act1/sv/script.json': [],
      'audio/act1/sv/manifest.json': {},
    })
    const projectFile = join(root, 'audio-studio.json')
    expect(await startAudition(projectFile, 'mira', fishFor, 'sv')).toMatchObject({
      ok: false,
      reason: 'no-phrase',
    })
    expect(await sessionFor(projectFile, 'mira', 'sv')).toEqual({ ok: true, session: null })
  })

  it('discards one language’s audition and leaves the others', async () => {
    const { projectFile } = await begin()
    await startAudition(projectFile, 'mira', fishFor)
    await discardSession(projectFile, 'mira', 'sv')
    expect(await sessionFor(projectFile, 'mira', 'sv')).toEqual({ ok: true, session: null })
    const en = await sessionFor(projectFile, 'mira')
    expect(en?.ok && en.session).not.toBeNull()
  })
})

describe('voicesInUse', () => {
  it('names every voice cast, and every voice on an audition in progress', async () => {
    const { projectFile, session } = await started()
    await moveVoice(projectFile, 'mira', 'a', 'drop')
    // The last voice dropped can be brought back with Undo: it is in use too.
    expect([...(await voicesInUse(projectFile))!].sort()).toEqual(
      [...new Set(['cur', 't1', ...session.toHear, ...session.queue])].sort(),
    )
    // One dropped before it cannot.
    await moveVoice(projectFile, 'mira', 'b', 'drop')
    const used = await voicesInUse(projectFile)
    expect(used!.has('b')).toBe(true)
    expect(used!.has('a')).toBe(false)
  })

  it('knows nothing in use when the cast or a session cannot be read, so nothing is freed', async () => {
    const { root, projectFile } = await started()
    const [file] = readdirSync(join(root, '.audio-studio/auditions'))
    writeFileSync(join(root, '.audio-studio/auditions', file!), '{"version": 2}')
    expect(await voicesInUse(projectFile)).toBeNull()
    // One of an earlier version is no audition in progress.
    writeFileSync(join(root, '.audio-studio/auditions', file!), '{"version": 1}')
    expect([...(await voicesInUse(projectFile))!].sort()).toEqual(['cur', 't1'])
    const broken = tempRepo({ ...files, 'tts/cast.json': '{ not json' })
    expect(await voicesInUse(join(broken, 'audio-studio.json'))).toBeNull()
  })

  it('names only the cast when no audition is in progress', async () => {
    const root = tempRepo(files)
    expect([...(await voicesInUse(join(root, 'audio-studio.json')))!].sort()).toEqual(['cur', 't1'])
  })
})

describe('voicesRemoved', () => {
  it('marks a library voice removed as not added on the audition showing it', async () => {
    const { projectFile } = await started()
    const { client } = fakeEleven()
    client.sharedVoices = async () => ({
      voices: [{ ...voice('eleven:l1', 'Warm l1'), library: { owner: 'o', added: true } }],
      more: false,
    })
    await moreVoices(projectFile, 'mira', fishFor, undefined, {
      provider: 'elevenlabs',
      elevenFor: async () => client,
    })
    await voicesRemoved(projectFile, ['eleven:l1'])
    const result = await sessionFor(projectFile, 'mira')
    expect(result?.ok && result.session?.voices['eleven:l1']?.library).toEqual({
      owner: 'o',
      added: false,
    })
  })
})
