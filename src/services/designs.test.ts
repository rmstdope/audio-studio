import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { isDesignId } from '../core/design'
import type { Voice } from '../core/voiceSearch'
import { castDesign, designVoices, designsFor } from './designs'
import { designPreviewPath, readDesigns } from './designStore'
import type { Encoder } from './audio'
import type { DesignVoiceRequest, FishClient } from './fish'
import { FishError } from './fish'
import { moveVoice, sessionFor, startAudition, viewOf } from './sessions'

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': {
    speakers: { mira: { voice: 'cur', style: '[low]', audition: { keywords: ['warm'] } } },
    pronounce: {},
  },
  'tts/act1/script.json': [{ key: 'a1', speaker: 'mira', text: 'Welcome.' }],
}

function voice(id: string, title = id): Voice {
  return {
    id,
    title,
    description: '',
    tags: [],
    languages: [],
    uses: 0,
    likes: 0,
    author: '',
    sample: null,
  }
}

/** A Fish that designs `count` voices, lists `own` voices and saves what it is given. */
function fishThat(
  options: {
    own?: string[]
    design?: (request: DesignVoiceRequest) => Promise<{ id: string; wav: Uint8Array }[]>
    create?: FishClient['createVoice']
  } = {},
) {
  const designed: DesignVoiceRequest[] = []
  const created: Parameters<FishClient['createVoice']>[0][] = []
  const fish: FishClient = {
    async listVoices() {
      return { total: 0, items: [] }
    },
    async getVoice(id) {
      return voice(id)
    },
    async listOwnVoices() {
      return (options.own ?? []).map((title, i) => ({ ...voice(`own${i}`, title), own: true }))
    },
    async tts() {
      return new Uint8Array([1])
    },
    async credit() {
      return 5
    },
    async createVoice(request) {
      created.push(request)
      return options.create
        ? options.create(request)
        : { ...voice('saved1', request.title), own: true }
    },
    async designVoice(request) {
      designed.push(request)
      return options.design
        ? options.design(request)
        : Array.from({ length: request.count }, (_, i) => ({
            id: `c${i}`,
            wav: new Uint8Array([i]),
          }))
    },
  }
  return { fishFor: async () => fish, designed, created }
}

/** An encoder that writes the bytes it is given, as the "mp3". */
const encode: Encoder = async (wav, file) => {
  await Bun.write(file, wav)
}

function setup() {
  const root = tempRepo(files)
  return { root, projectFile: join(root, 'audio-studio.json') }
}

describe('designVoices', () => {
  it('keeps four numbered designs with their previews and the description', async () => {
    const { root, projectFile } = setup()
    const { fishFor, designed } = fishThat()
    const result = await designVoices(projectFile, 'mira', '  An old woman  ', fishFor, encode)
    expect(result).toEqual({ ok: true, added: 4 })
    expect(designed[0]).toMatchObject({ instruction: 'An old woman', count: 4 })
    expect(designed[0]?.referenceText.length).toBeGreaterThan(0)
    const store = await readDesigns(projectFile, 'mira')
    expect(store.description).toBe('An old woman')
    const voices = Object.values(store.voices)
    expect(voices.map((v) => v.title)).toEqual(['Design 1', 'Design 2', 'Design 3', 'Design 4'])
    expect(voices.every((v) => isDesignId(v.id))).toBe(true)
    for (const v of voices) expect(existsSync(join(root, designPreviewPath(v.id)))).toBe(true)
    expect(await designsFor(projectFile, 'mira')).toEqual({ ok: true, description: 'An old woman' })
  })

  it('numbers the next designs on, and puts them in the audition going on', async () => {
    const { projectFile } = setup()
    const { fishFor } = fishThat()
    await startAudition(projectFile, 'mira', fishFor)
    await designVoices(projectFile, 'mira', 'one', fishFor, encode)
    await designVoices(projectFile, 'mira', 'two', fishFor, encode)
    const found = await sessionFor(projectFile, 'mira')
    const session = found?.ok ? found.session : null
    expect(session?.designed.length).toBe(8)
    expect(session?.voices[session.designed[7]!]?.title).toBe('Design 8')
    const view = await viewOf(projectFile, 'mira', { ok: true, session })
    expect(view.ok && Object.keys(view.takes).filter(isDesignId).length).toBe(8)
  })

  it('stores nothing when Fish refuses, and says why', async () => {
    const { projectFile } = setup()
    const { fishFor } = fishThat({
      design: () => Promise.reject(new FishError(402, 'Insufficient credit')),
    })
    const result = await designVoices(projectFile, 'mira', 'old', fishFor, encode)
    expect(result).toEqual({ ok: false, reason: 'fish', message: 'Insufficient credit' })
    const store = await readDesigns(projectFile, 'mira')
    expect(store.voices).toEqual({})
    expect(store.made).toBe(0)
  })

  it('refuses an empty or too long description without asking Fish', async () => {
    const { projectFile } = setup()
    const { fishFor, designed } = fishThat()
    for (const text of ['  ', 'x'.repeat(2001)]) {
      const result = await designVoices(projectFile, 'mira', text, fishFor, encode)
      expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    }
    expect(designed).toEqual([])
  })

  it('knows when there is no key, or no such character', async () => {
    const { projectFile } = setup()
    expect(await designVoices(projectFile, 'mira', 'old', async () => null, encode)).toMatchObject({
      ok: false,
      reason: 'no-key',
    })
    expect(await designVoices(projectFile, 'nobody', 'old', fishThat().fishFor, encode)).toBeNull()
  })
})

describe('designs between auditions', () => {
  it('shows kept designs in a new audition, but not a dropped one', async () => {
    const { projectFile } = setup()
    const { fishFor } = fishThat()
    await designVoices(projectFile, 'mira', 'old', fishFor, encode)
    const first = await startAudition(projectFile, 'mira', fishFor)
    if (!first?.ok) throw new Error('no session')
    const [a, b, c, d] = first.session.designed as [string, string, string, string]
    expect([a, b, c, d].length).toBe(4)
    await moveVoice(projectFile, 'mira', b, 'drop')
    await moveVoice(projectFile, 'mira', c, 'shortlist')
    const again = await startAudition(projectFile, 'mira', fishFor)
    if (!again?.ok) throw new Error('no session')
    // The shortlist is let go with the audition; only the dropped design stays away.
    expect(again.session.designed).toEqual([a, c, d])
    expect(again.session.designed).not.toContain(b)
  })
})

describe('castDesign', () => {
  async function shortlisted(own: string[] = [], create?: FishClient['createVoice']) {
    const { root, projectFile } = setup()
    const fish = fishThat({ own, create })
    await designVoices(projectFile, 'mira', 'old', fish.fishFor, encode)
    const started = await startAudition(projectFile, 'mira', fish.fishFor)
    if (!started?.ok) throw new Error('no session')
    const [first, second] = started.session.designed as [string, string]
    await moveVoice(projectFile, 'mira', first, 'shortlist')
    return { root, projectFile, fish, first, second }
  }

  it('saves the design to the account under the character’s name, then casts it', async () => {
    const { root, projectFile, fish, first } = await shortlisted()
    const result = await castDesign(projectFile, 'mira', first, fish.fishFor)
    expect(result).toMatchObject({ ok: true, voice: { id: 'saved1', name: 'Mira (designed)' } })
    expect(fish.created[0]?.title).toBe('Mira (designed)')
    expect(fish.created[0]?.files[0]).toMatchObject({ type: 'audio/mpeg' })
    expect(JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8')).speakers.mira.voice).toBe(
      'saved1',
    )
    // The audition is over; the cast design is no longer kept, the others are.
    expect(await sessionFor(projectFile, 'mira')).toEqual({ ok: true, session: null })
    const kept = Object.keys((await readDesigns(projectFile, 'mira')).voices)
    expect(kept.length).toBe(3)
    expect(kept).not.toContain(first)
  })

  it('names a second saved design (designed 2)', async () => {
    const { projectFile, fish, first } = await shortlisted(['Mira (designed)'])
    await castDesign(projectFile, 'mira', first, fish.fishFor)
    expect(fish.created[0]?.title).toBe('Mira (designed 2)')
  })

  it('casts nothing when Fish cannot save it, and keeps the design shortlisted', async () => {
    const { root, projectFile, fish, first } = await shortlisted([], () =>
      Promise.reject(new FishError(400, 'Audio too short')),
    )
    const result = await castDesign(projectFile, 'mira', first, fish.fishFor)
    expect(result).toEqual({
      ok: false,
      reason: 'save',
      voice: first,
      message: 'Audio too short',
    })
    expect(JSON.parse(readFileSync(join(root, 'tts/cast.json'), 'utf8')).speakers.mira.voice).toBe(
      'cur',
    )
    const found = await sessionFor(projectFile, 'mira')
    expect(found?.ok && found.session?.shortlist).toContain(first)
    expect(Object.keys((await readDesigns(projectFile, 'mira')).voices)).toContain(first)
  })

  it('only casts a design that is on the shortlist', async () => {
    const { projectFile, fish, second } = await shortlisted()
    const result = await castDesign(projectFile, 'mira', second, fish.fishFor)
    expect(result).toMatchObject({ ok: false, reason: 'not-shortlisted' })
    expect(fish.created).toEqual([])
  })
})

describe('designs per language', () => {
  const base = projectJson()
  const several = {
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
    'tts/act1/script.json': undefined,
    'tts/act1/en/script.json': [{ key: 'a1', speaker: 'mira', text: 'Welcome.' }],
    'tts/act1/sv/script.json': [{ key: 'a1', speaker: 'mira', text: 'Välkommen.' }],
  }

  it('keeps the designs and the last description of each language apart', async () => {
    const projectFile = join(tempRepo(several), 'audio-studio.json')
    const { fishFor, designed } = fishThat()
    await designVoices(projectFile, 'mira', 'en voice', fishFor, encode, 'en')
    await designVoices(projectFile, 'mira', 'sv voice', fishFor, encode, 'sv')
    expect(designed.map((d) => d.language)).toEqual(['en', 'sv'])
    expect(await designsFor(projectFile, 'mira', 'en')).toEqual({
      ok: true,
      description: 'en voice',
    })
    expect(await designsFor(projectFile, 'mira', 'sv')).toEqual({
      ok: true,
      description: 'sv voice',
    })
    expect(Object.keys((await readDesigns(projectFile, 'mira', 'sv')).voices).length).toBe(4)
    const swedish = await startAudition(projectFile, 'mira', fishFor, 'sv')
    expect(swedish?.ok && swedish.session.designed.length).toBe(4)
  })
})
