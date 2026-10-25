import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Voice } from '../core/voiceSearch'
import type { FishClient } from './fish'
import {
  addVoiceById,
  auditionMoney,
  recordSpent,
  castVoice,
  changeSession,
  discardSession,
  moreVoices,
  moveVoice,
  recordedLines,
  sessionFor,
  startAudition,
  undoLastDrop,
} from './sessions'
import { ruledOutIds, updateRuledOut } from './ruledOut'
import { setKeywords } from './auditions'

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

  it('keeps what takes were charged in the saved audition, across sittings', async () => {
    const projectFile = join(tempRepo(paidFiles), 'audio-studio.json')
    await startAudition(projectFile, 'mira', fishFor)
    await recordSpent(projectFile, 'mira', 0.01)
    await recordSpent(projectFile, 'mira', 0.02)
    const money = await auditionMoney(projectFile, 'mira')
    expect(money?.ok && money.spentBefore).toBeCloseTo(0.03, 12)
  })

  it('is null for an unknown character, and records nothing without an audition', async () => {
    const projectFile = join(tempRepo(paidFiles), 'audio-studio.json')
    expect(await auditionMoney(projectFile, 'nobody')).toBeNull()
    await recordSpent(projectFile, 'mira', 0.01)
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
  })
})
