import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Voice } from '../core/voiceSearch'
import type { FishClient } from './fish'
import {
  addVoiceById,
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
  it('starts from the search, the current voice on the shortlist, and saves it', async () => {
    const { projectFile, session } = await started()
    expect(session.shortlist).toEqual(['cur'])
    expect(session.toHear).toEqual(['a', 'b', 'c'])
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

  it('takes an audition saved in rounds, before the shortlist, for none', async () => {
    const { root, projectFile } = await started()
    const [file] = readdirSync(join(root, '.audio-studio/auditions'))
    const path = join(root, '.audio-studio/auditions', file!)
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), version: 1 }))
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
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
    const result = await startAudition(projectFile, 'mira', fishFor)
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.session.toHear).toEqual(['b', 'c', 'd'])
    expect(result.session.queue).toEqual(['f', 'g'])
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
    const result = await startAudition(projectFile, 'mira', fishFor, language)
    if (!result?.ok) throw new Error(JSON.stringify(result))
    return { root, projectFile, session: result.session }
  }
  const castFile = (root: string) => JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8'))

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

  it('discards one language’s audition and leaves the others', async () => {
    const { projectFile } = await begin()
    await startAudition(projectFile, 'mira', fishFor)
    await discardSession(projectFile, 'mira', 'sv')
    expect(await sessionFor(projectFile, 'mira', 'sv')).toEqual({ ok: true, session: null })
    const en = await sessionFor(projectFile, 'mira')
    expect(en?.ok && en.session).not.toBeNull()
  })
})
