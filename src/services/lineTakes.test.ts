import { describe, expect, it } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { clipInputs, fingerprint } from '../core/fingerprint'
import { ProjectSchema } from '../core/project'
import { createBudget, type Budget } from '../core/spend'
import { readWav, writeWav } from '../core/wav'
import type { Encoder } from './audio'
import type { ElevenLabsClient } from './elevenlabs'
import type { FishClient, TtsRequest } from './fish'
import { createLimiter, type Limiter } from './limit'
import { dropLineTake, lineTakeFile, listLineTakes, takeLine, useLineTake } from './lineTakes'
import type { Transcriber } from './transcriber'
import { loadPart } from './workspace'

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': {
    speakers: { narrator: { voice: 'v-n', style: '[warm]' } },
    pronounce: { Elior: 'El-ee-or' },
  },
  'tts/act1/script.json': [
    { key: 'k1', speaker: 'narrator', text: 'Elior wakes up.' },
    { key: 'k3', speaker: 'tilda', text: 'No voice.' },
  ],
}

/** A second of silence as Fish would send it. */
function silence(seconds: number): Uint8Array {
  return writeWav({
    format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
    data: new Uint8Array(Math.round(seconds * 1000) * 2),
  })
}

function fakeFish() {
  const requests: TtsRequest[] = []
  const fish: FishClient = {
    async listOwnVoices() {
      return []
    },
    createVoice: () => Promise.reject(new Error('not used')),
    designVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      return 25
    },
    listVoices: () => Promise.reject(new Error('not used')),
    getVoice: () => Promise.reject(new Error('not used')),
    async tts(request) {
      requests.push(request)
      return silence(1)
    },
  }
  return { fish, requests }
}

/** A transcriber hearing the words given, each 0.3 s apart. */
function hearing(words: string[]): Transcriber {
  return {
    async transcribe() {
      return [
        {
          start: 0,
          end: 0.95,
          words: words.map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.25 })),
        },
      ]
    },
    close() {},
  }
}

/** An encoder that keeps the WAV as it is, so tests need no ffmpeg. */
const keepWav: Encoder = async (wav, file) => {
  await mkdir(dirname(file), { recursive: true })
  writeFileSync(file, wav)
}

const projectFileOf = (root: string) => join(root, 'audio-studio.json')
const free = createBudget({ model: 's2.1-pro-free', dollars: 0 })
const take = (
  root: string,
  fish: FishClient,
  transcriber: Transcriber | null = null,
  budget: Budget = free,
) =>
  takeLine(projectFileOf(root), 'act1', 'k1', async () => fish, {
    limiter: createLimiter(),
    transcriber,
    budget,
  })

describe('takeLine', () => {
  it('records a take of the line into the cache, checked, and lists it as current', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await take(root, fish, hearing(['El-ee-or', 'wakes', 'up.']))
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.take).toMatchObject({ seconds: 1, heard: 1, current: true })
    expect(requests).toEqual([
      expect.objectContaining({ text: '[warm] El-ee-or wakes up.', voice: 'v-n', format: 'wav' }),
    ])
    const file = await lineTakeFile(projectFileOf(root), 'act1', 'k1', result.take.id)
    expect(file).not.toBeNull()
    expect(readWav(readFileSync(file!)).data.length).toBe(2000)
    const listed = await listLineTakes(projectFileOf(root), 'act1', 'k1')
    expect(listed).toEqual({ ok: true, takes: [result.take] })
    // Nothing of the game's.
    expect(existsSync(join(root, 'audio/act1'))).toBe(false)
    expect(existsSync(join(root, 'tts/act1/narration.lock.json'))).toBe(false)
  })

  it('records an unchecked take when the project does not check, and lists newest first', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const first = await take(root, fish)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await take(root, fish)
    if (!first?.ok || !second?.ok) throw new Error('expected takes')
    expect(first.take.heard).toBeNull()
    const listed = await listLineTakes(projectFileOf(root), 'act1', 'k1')
    expect(listed?.ok && listed.takes.map((t) => t.id)).toEqual([second.take.id, first.take.id])
  })

  it('refuses a line without a voice, and says when there is no key', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const uncast = await takeLine(projectFileOf(root), 'act1', 'k3', async () => fish, {
      limiter: createLimiter(),
      budget: free,
    })
    expect(uncast).toMatchObject({ ok: false, reason: 'uncast' })
    expect(requests).toHaveLength(0)
    const noKey = await takeLine(projectFileOf(root), 'act1', 'k1', async () => null, {
      limiter: createLimiter(),
      budget: free,
    })
    expect(noKey).toMatchObject({ ok: false, reason: 'no-key' })
    expect(
      await takeLine(projectFileOf(root), 'act9', 'k1', async () => fish, {
        limiter: createLimiter(),
        budget: free,
      }),
    ).toBeNull()
    expect(
      await takeLine(projectFileOf(root), 'act1', 'zz', async () => fish, {
        limiter: createLimiter(),
        budget: free,
      }),
    ).toBeNull()
  })

  it('reports Fish failing', async () => {
    const root = tempRepo(files)
    const failing: FishClient = { ...fakeFish().fish, tts: () => Promise.reject(new Error('boom')) }
    expect(await take(root, failing)).toEqual({ ok: false, reason: 'fish', message: 'boom' })
  })
})

describe('takeLine, a paid draft model', () => {
  const paid = () =>
    tempRepo({
      ...files,
      'audio-studio.json': {
        ...projectJson(),
        narration: {
          ...(projectJson().narration as Record<string, unknown>),
          models: { draft: 's1', final: 's1' },
        },
      },
    })

  it('records a take against the budget it is given', async () => {
    const root = paid()
    const { fish, requests } = fakeFish()
    const budget = createBudget({ model: 's1', dollars: 1 })
    const result = await take(root, fish, null, budget)
    expect(result).toMatchObject({ ok: true, take: { current: true } })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.model).toBe('s1')
    expect(budget.left).toBeLessThan(1)
  })

  it('sends nothing to Fish when the budget does not cover the take', async () => {
    const root = paid()
    const { fish, requests } = fakeFish()
    const result = await take(root, fish, null, createBudget({ model: 's1', dollars: 0 }))
    expect(result).toMatchObject({ ok: false, reason: 'spend' })
    expect(requests).toHaveLength(0)
    expect(await listLineTakes(projectFileOf(root), 'act1', 'k1')).toEqual({ ok: true, takes: [] })
  })
})

describe('useLineTake', () => {
  it('makes the take the line’s clip, with its timings and score, as a recording does', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const made = await take(root, fish, hearing(['El-ee-or', 'wakes', 'up.']))
    if (!made?.ok) throw new Error('expected a take')
    const used = await useLineTake(projectFileOf(root), 'act1', 'k1', made.take.id, {
      encode: keepWav,
    })
    expect(used).toEqual({ ok: true, key: 'k1', duration: 1, heard: 1, takes: 1 })
    const manifest = JSON.parse(readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8'))
    expect(manifest.k1).toMatchObject({
      file: 'k1.mp3',
      speaker: 'narrator',
      duration: 1,
      words: [
        { word: 'Elior', start: 0, end: 0.25 },
        { word: 'wakes', start: 0.3, end: 0.55 },
        { word: 'up.', start: 0.6, end: 0.85 },
      ],
    })
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(lock.k1).toMatchObject({ heard: 1, takes: 1, voice: 'v-n', model: 's2.1-pro-free' })
    const part = await loadPart(projectFileOf(root), 'act1')
    expect(part?.ok && part.part.lines[0]?.status).toBe('ok')
    // The take stays in the cache, to compare with later ones.
    expect(await listLineTakes(projectFileOf(root), 'act1', 'k1')).toMatchObject({
      ok: true,
      takes: [{ id: made.take.id, current: true }],
    })
  })

  it('refuses a take made before the line changed, which the list marks stale', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const made = await take(root, fish)
    if (!made?.ok) throw new Error('expected a take')
    writeFileSync(join(root, 'tts/act1/cues.json'), JSON.stringify({ k1: '[hushed]' }))
    const listed = await listLineTakes(projectFileOf(root), 'act1', 'k1')
    expect(listed?.ok && listed.takes[0]?.current).toBe(false)
    const used = await useLineTake(projectFileOf(root), 'act1', 'k1', made.take.id, {
      encode: keepWav,
    })
    expect(used).toMatchObject({ ok: false, reason: 'stale' })
    expect(existsSync(join(root, 'audio/act1/manifest.json'))).toBe(false)
  })

  it('never replaces a final clip: a take is a draft one', async () => {
    const project = {
      ...projectJson(),
      narration: {
        ...(projectJson().narration as Record<string, unknown>),
        models: { draft: 's2.1-pro-free', final: 's1' },
      },
    }
    const parsed = ProjectSchema.parse(project)
    const cast = {
      speakers: { narrator: { voice: 'v-n', style: '[warm]' } },
      pronounce: { Elior: 'El-ee-or' },
    }
    const line = { key: 'k1', speaker: 'narrator', text: 'Elior wakes up.' }
    const finalInputs = clipInputs(
      line,
      cast.speakers.narrator,
      {},
      cast.pronounce,
      parsed.narration,
      's1',
    )!
    const { fp, parts } = fingerprint(finalInputs)
    const root = tempRepo({
      ...files,
      'audio-studio.json': project,
      'audio/act1/manifest.json': { k1: { file: 'k1.mp3', speaker: 'narrator', duration: 1 } },
      'audio/act1/k1.mp3': 'paid',
      'tts/act1/narration.lock.json': { k1: { fp, voice: 'v-n', model: 's1', parts, at: 'then' } },
    })
    const { fish } = fakeFish()
    const made = await take(root, fish)
    if (!made?.ok) throw new Error(JSON.stringify(made))
    const used = await useLineTake(projectFileOf(root), 'act1', 'k1', made.take.id, {
      encode: keepWav,
    })
    expect(used).toMatchObject({ ok: false, reason: 'final' })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('paid')
  })

  it('reports a broken file of the part with its path, as a recording does', async () => {
    const root = tempRepo({ ...files, 'tts/act1/narration.lock.json': 'not json' })
    const { fish } = fakeFish()
    expect(await take(root, fish)).toMatchObject({
      ok: false,
      problems: [{ file: 'tts/act1/narration.lock.json' }],
    })
  })

  it('knows no take that is not there', async () => {
    const root = tempRepo(files)
    expect(
      await useLineTake(projectFileOf(root), 'act1', 'k1', 'f'.repeat(16), { encode: keepWav }),
    ).toBeNull()
  })
})

describe('dropLineTake', () => {
  it('removes the take’s two files, and knows no other', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const made = await take(root, fish)
    if (!made?.ok) throw new Error('expected a take')
    const file = (await lineTakeFile(projectFileOf(root), 'act1', 'k1', made.take.id))!
    expect(await dropLineTake(projectFileOf(root), 'act1', 'k1', made.take.id)).toEqual({
      ok: true,
    })
    expect(readdirSync(dirname(file))).toEqual([])
    expect(await dropLineTake(projectFileOf(root), 'act1', 'k1', made.take.id)).toBeNull()
    expect(await lineTakeFile(projectFileOf(root), 'act1', 'k1', 'not-an-id')).toBeNull()
  })

  it('does not list a take whose audio is gone', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const made = await take(root, fish)
    if (!made?.ok) throw new Error('expected a take')
    rmSync((await lineTakeFile(projectFileOf(root), 'act1', 'k1', made.take.id))!)
    expect(await listLineTakes(projectFileOf(root), 'act1', 'k1')).toEqual({ ok: true, takes: [] })
    expect(
      await useLineTake(projectFileOf(root), 'act1', 'k1', made.take.id, { encode: keepWav }),
    ).toBeNull()
  })
})

describe('takes of a line in a language besides the source', () => {
  const several = projectJson()
  const narration = several.narration as Record<string, unknown>
  narration.languages = ['en', 'sv']
  narration.paths = {
    dialog: 'tts/{part}/{language}/script.json',
    cues: 'tts/{part}/{language}/cues.json',
    lock: 'tts/{part}/{language}/narration.lock.json',
    clips: 'audio/{part}/{language}',
    manifest: 'audio/{part}/{language}/manifest.json',
  }
  const swedish = {
    'audio-studio.json': several,
    'tts/cast.json': {
      speakers: {
        narrator: { voice: 'v-n', style: '[warm]', languages: { sv: { voice: 'v-sv' } } },
      },
    },
    'tts/act1/en/script.json': [{ key: 'k1', speaker: 'narrator', text: 'Elior wakes up.' }],
    'tts/act1/sv/script.json': [{ key: 'k1', speaker: 'narrator', text: 'Elior vaknar.' }],
    'tts/act1/en/cues.json': { k1: '[worried]' },
  }

  it('keeps a language’s takes apart, makes one the clip of that language only, and drops it', async () => {
    const root = tempRepo(swedish)
    const { fish, requests } = fakeFish()
    const result = await takeLine(projectFileOf(root), 'act1', 'k1', async () => fish, {
      limiter: createLimiter(),
      budget: free,
      language: 'sv',
    })
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(requests.map((r) => [r.text, r.voice])).toEqual([['[worried] Elior vaknar.', 'v-sv']])
    const sv = (file: string | null) => file !== null
    expect(sv(await lineTakeFile(projectFileOf(root), 'act1', 'k1', result.take.id, 'sv'))).toBe(
      true,
    )
    expect(await lineTakeFile(projectFileOf(root), 'act1', 'k1', result.take.id)).toBeNull()
    expect(await listLineTakes(projectFileOf(root), 'act1', 'k1')).toEqual({ ok: true, takes: [] })
    const listed = await listLineTakes(projectFileOf(root), 'act1', 'k1', 'sv')
    expect(listed).toEqual({ ok: true, takes: [result.take] })

    const used = await useLineTake(projectFileOf(root), 'act1', 'k1', result.take.id, {
      encode: keepWav,
      language: 'sv',
    })
    expect(used).toMatchObject({ ok: true, key: 'k1' })
    expect(existsSync(join(root, 'audio/act1/sv/k1.mp3'))).toBe(true)
    expect(existsSync(join(root, 'audio/act1/en/k1.mp3'))).toBe(false)

    expect(await dropLineTake(projectFileOf(root), 'act1', 'k1', result.take.id, 'sv')).toEqual({
      ok: true,
    })
    expect(await listLineTakes(projectFileOf(root), 'act1', 'k1', 'sv')).toEqual({
      ok: true,
      takes: [],
    })
  })
})

describe('takeLine, with an ElevenLabs voice', () => {
  const elevenFiles = {
    ...files,
    'tts/cast.json': { speakers: { narrator: { voice: 'eleven:abc', speed: 1.5 } }, pronounce: {} },
  }
  it('is spoken by ElevenLabs, refused without its key or at a speed it does not take', async () => {
    const asked: string[] = []
    const eleven: ElevenLabsClient = {
      subscription: () => Promise.reject(new Error('not used')),
      music: () => Promise.reject(new Error('not used')),
      voice: () => Promise.reject(new Error('not used')),
      async tts(request) {
        asked.push(request.voice)
        return silence(1)
      },
    }
    const run = (root: string, client: ElevenLabsClient | null) =>
      takeLine(projectFileOf(root), 'act1', 'k1', async () => fakeFish().fish, {
        limiter: createLimiter(),
        budget: createBudget({ model: 's2.1-pro-free', dollars: 0 }),
        credits: createBudget({ model: 'eleven_v3', dollars: 100 }),
        elevenlabs: async () => client,
      })
    expect(await run(tempRepo(elevenFiles), eleven)).toMatchObject({ ok: false, reason: 'speed' })
    const calm = tempRepo({
      ...elevenFiles,
      'tts/cast.json': { speakers: { narrator: { voice: 'eleven:abc' } }, pronounce: {} },
    })
    expect(await run(calm, null)).toMatchObject({ ok: false, reason: 'no-key' })
    expect(await run(calm, eleven)).toMatchObject({ ok: true })
    expect(asked).toEqual(['abc'])
  })
})

describe('takeLine, its provider’s budget and slots', () => {
  it('charges an ElevenLabs line to the credits and waits for ElevenLabs’ slots, never Fish’s', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': { speakers: { narrator: { voice: 'eleven:abc' } }, pronounce: {} },
    })
    const used: string[] = []
    const watched = (name: string): Limiter => ({
      run: (_key, _limit, job) => (used.push(name), job()),
    })
    const eleven: ElevenLabsClient = {
      subscription: () => Promise.reject(new Error('not used')),
      music: () => Promise.reject(new Error('not used')),
      voice: () => Promise.reject(new Error('not used')),
      tts: async () => silence(1),
    }
    const credits = createBudget({ model: 'eleven_v3', dollars: 100 })
    const result = await takeLine(projectFileOf(root), 'act1', 'k1', async () => fakeFish().fish, {
      limiter: watched('fish'),
      elevenLimiter: watched('elevenlabs'),
      budget: createBudget({ model: 's2-pro', dollars: 5 }),
      credits,
      elevenlabs: async () => eleven,
    })
    expect(result).toMatchObject({ ok: true })
    expect(used).toEqual(['elevenlabs'])
    expect(credits.left).toBeLessThan(100)
  })
})
