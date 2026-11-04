import { describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { writeWav } from '../core/wav'
import type { Encoder } from './audio'
import { createEffectTakes } from './effectTakes'
import type { EffectGenerator } from './effects'
import type { EffectModelId } from '../core/effectModels'
import type { ImageDownload } from '../core/imageModels'
import { createSerial } from './serial'

const effects = {
  paths: {
    list: 'tts/effects.json',
    lock: 'audio/effects.lock.json',
    clips: 'audio/effects',
    manifest: 'audio/effects/manifest.json',
  },
}

const LIST = [
  { id: 'door-creak', description: 'A slow wooden door creaks open', seconds: 3 },
  { id: 'coins', description: 'Coins spill on stone', seconds: 0.5 },
  { id: 'thunder', description: 'Thunder rolls', seconds: 4 },
  { id: 'broken', description: 'fail always', seconds: 1 },
]

/** The studio over a fake generator; `hold` keeps every take waiting until released. */
function setup(
  options: { downloads?: Partial<Record<EffectModelId, ImageDownload>>; hold?: boolean } = {},
) {
  const root = tempRepo({
    'content-studio.json': projectJson({ effects }),
    'tts/effects.json': LIST,
  })
  const file = join(root, 'content-studio.json')
  const requests: { prompt: string; model: EffectModelId }[] = []
  let release = () => {}
  const gate = options.hold ? new Promise<void>((resolve) => (release = resolve)) : null
  const generator: EffectGenerator = {
    download: (model) => options.downloads?.[model] ?? 'whole',
    ready: async (model) =>
      (options.downloads?.[model] ?? 'whole') === 'whole'
        ? { ok: true }
        : { ok: false, message: `${model} is not here` },
    async generate(request, signal) {
      requests.push({ prompt: request.prompt, model: request.model })
      if (gate) await gate
      if (signal?.aborted) throw new Error('stopped')
      if (request.prompt.includes('fail')) throw new Error('The effects generator stopped.')
      const samples = new Int16Array(1000)
      const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
      return { wav: writeWav({ format, data: new Uint8Array(samples.buffer) }), seed: request.seed }
    },
    close: async () => {},
  }
  const encode: Encoder = async (_wav, out) => {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, 'mp3')
  }
  const takes = createEffectTakes({
    generator,
    encode,
    queue: createSerial(),
    gpu: createSerial(),
    hasUv: () => true,
    now: () => 0,
    newSeed: () => 1,
  })
  /** Waits until nothing is waiting or being made. */
  async function idle() {
    for (let i = 0; i < 300; i++) {
      if (!Object.keys(await takes.making(file)).length) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('takes never finished')
  }
  return { root, file, takes, requests, release: () => release(), idle }
}

describe('makeAll', () => {
  it('starts four takes for each listed effect with no chosen take', async () => {
    const { file, takes, requests, idle } = setup()
    const result = await takes.makeAll(file, ['door-creak', 'coins'])
    expect(result).toEqual({
      ok: true,
      started: [
        { id: 'door-creak', takes: 4 },
        { id: 'coins', takes: 4 },
      ],
    })
    await idle()
    expect(requests).toHaveLength(8)
    expect(requests.every((r) => r.model === 'small-sfx')).toBe(true)
    expect(await takes.batch(file)).toEqual({
      total: 8,
      made: 8,
      stopped: 0,
      failed: [],
      running: false,
    })
    const view = await takes.view(file, 'coins')
    expect(view && 'takes' in view && view.takes).toHaveLength(4)
  })

  it('skips an effect with a chosen take, one already making takes, an unknown id and a repeat', async () => {
    const { file, takes, idle, release } = setup({ hold: true })
    await takes.make(file, 'thunder', { count: 1 })
    const done = setup()
    await done.takes.make(done.file, 'coins', { count: 1 })
    await done.idle()
    const view = await done.takes.view(done.file, 'coins')
    if (!view || !('takes' in view)) throw new Error('view')
    await done.takes.choose(done.file, 'coins', view.takes[0]!.file)
    expect(
      await done.takes.makeAll(done.file, ['coins', 'nope', 'door-creak', 'door-creak']),
    ).toEqual({
      ok: true,
      started: [{ id: 'door-creak', takes: 4 }],
    })
    expect(await takes.makeAll(file, ['thunder', 'door-creak'])).toEqual({
      ok: true,
      started: [{ id: 'door-creak', takes: 4 }],
    })
    expect(await takes.batch(file)).toMatchObject({ total: 4 })
    release()
    await idle()
  })

  it('uses the other model when Setup’s is not on this computer', async () => {
    const { file, takes, requests, idle } = setup({ downloads: { 'small-sfx': 'absent' } })
    expect(await takes.makeAll(file, ['coins'])).toEqual({
      ok: true,
      started: [{ id: 'coins', takes: 4 }],
    })
    await idle()
    expect(requests.every((r) => r.model === 'open-1')).toBe(true)
  })

  it('starts nothing when neither model can run', async () => {
    const { file, takes, idle } = setup({
      downloads: { 'small-sfx': 'absent', 'open-1': 'absent' },
    })
    const result = await takes.makeAll(file, ['coins', 'thunder'])
    expect(result).toMatchObject({ ok: false })
    expect(await takes.making(file)).toEqual({})
    expect(await takes.batch(file)).toBeNull()
    await idle()
  })
})

describe('stopAll and batch', () => {
  it('stops every take waiting or being made in the project, keeping those made', async () => {
    const { file, takes, release } = setup({ hold: true })
    await takes.makeAll(file, ['door-creak', 'coins'])
    await takes.make(file, 'thunder', { count: 2 })
    expect(await takes.batch(file)).toMatchObject({ total: 8, running: true })
    const stopped = await takes.stopAll(file)
    expect(stopped).toEqual({ ok: true, stopped: 10 })
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await takes.making(file)).toEqual({})
    // Only the press's own takes are counted in its summary.
    expect(await takes.batch(file)).toEqual({
      total: 8,
      made: 0,
      stopped: 8,
      failed: [],
      running: false,
    })
  })

  it('counts a take stopped from an effect’s own page in the summary too', async () => {
    const { file, takes, release } = setup({ hold: true })
    await takes.makeAll(file, ['coins'])
    await takes.stop(file, 'coins')
    release()
    expect(await takes.batch(file)).toMatchObject({ total: 4, stopped: 4, made: 0 })
  })

  it('names the effects whose takes failed', async () => {
    const { file, takes, idle } = setup()
    await takes.makeAll(file, ['broken', 'coins'])
    await idle()
    const batch = await takes.batch(file)
    expect(batch).toMatchObject({ total: 8, made: 4, stopped: 0, running: false })
    expect(batch?.failed.map((f) => f.id)).toEqual(['broken', 'broken', 'broken', 'broken'])
  })
})

describe('the summary of a press is kept until it is closed or replaced', () => {
  it('is there for a caller who never saw the press, until closeBatch', async () => {
    const { file, takes, idle } = setup()
    await takes.makeAll(file, ['coins'])
    await idle()
    expect(await takes.batch(file)).toMatchObject({ total: 4, made: 4, running: false })
    expect(await takes.closeBatch(file)).toEqual({ ok: true })
    expect(await takes.batch(file)).toBeNull()
  })

  it('is dropped, once finished, when takes are started by hand', async () => {
    const { file, takes, idle } = setup()
    await takes.makeAll(file, ['coins'])
    await idle()
    await takes.make(file, 'thunder', { count: 1 })
    expect(await takes.batch(file)).toBeNull()
    await idle()
    expect(await takes.batch(file)).toBeNull()
  })

  it('is dropped, once finished, when one of its own failed takes is tried again', async () => {
    const { file, takes, idle } = setup()
    await takes.makeAll(file, ['broken'])
    await idle()
    expect(await takes.batch(file)).toMatchObject({ total: 4, running: false })
    await takes.make(file, 'broken', { retry: 1 })
    expect(await takes.batch(file)).toBeNull()
    await idle()
    expect(await takes.batch(file)).toBeNull()
  })

  it('is kept when takes are started by hand while the press still runs', async () => {
    const { file, takes, release, idle } = setup({ hold: true })
    await takes.makeAll(file, ['coins'])
    await takes.make(file, 'thunder', { count: 1 })
    expect(await takes.batch(file)).toMatchObject({ total: 4, running: true })
    release()
    await idle()
    expect(await takes.batch(file)).toMatchObject({ total: 4, made: 4, running: false })
  })
})

describe('a press that is stopped, or cannot start one effect', () => {
  it('counts takes stopped while the press is still starting as stopped, not made', async () => {
    const { file, takes, release } = setup({ hold: true })
    const pressing = takes.makeAll(file, ['door-creak', 'coins', 'thunder'])
    // Stop all arrives while the later effects are still being started.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await takes.stopAll(file)
    await pressing
    await takes.stopAll(file)
    release()
    const batch = await takes.batch(file)
    expect(batch?.total).toBe(12)
    expect(batch?.made).toBe(0)
    expect(batch?.stopped).toBe(12)
  })

  it('goes on past an effect whose board cannot be read', async () => {
    const { root, file, takes, idle } = setup()
    mkdirSync(join(root, '.content-studio/effect-boards'), { recursive: true })
    writeFileSync(join(root, '.content-studio/effect-boards/door-creak.json'), '{ nope')
    const result = await takes.makeAll(file, ['door-creak', 'coins'])
    expect(result).toEqual({ ok: true, started: [{ id: 'coins', takes: 4 }] })
    await idle()
  })
})

describe('models', () => {
  it('says which models can run and the project’s', async () => {
    const { file, takes } = setup({ downloads: { 'open-1': 'partial' } })
    expect(await takes.models(file)).toEqual({
      ok: true,
      canMake: true,
      projectModel: 'small-sfx',
      uv: true,
      models: [
        { id: 'small-sfx', download: 'whole', failed: false },
        { id: 'open-1', download: 'partial', failed: false },
      ],
    })
  })
})
