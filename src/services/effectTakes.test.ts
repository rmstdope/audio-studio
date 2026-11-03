import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { wavSeconds } from '../core/musicTake'
import { readWav, writeWav } from '../core/wav'
import type { Encoder } from './audio'
import { createEffectTakes } from './effectTakes'
import type { EffectGenerator, EffectRequest } from './effects'
import type { EffectHealthStore } from './effectHealth'
import { createSerial } from './serial'

const effects = {
  paths: {
    list: 'tts/effects.json',
    lock: 'audio/effects.lock.json',
    clips: 'audio/effects',
    manifest: 'audio/effects/manifest.json',
  },
}

/** A generator that makes a tone `length` seconds long (shorter than asked, as the model does), and fails for a description saying "fail". */
function fakeGenerator(ready: ReturnType<EffectGenerator['ready']> = { ok: true }, length = 1.4) {
  const requests: EffectRequest[] = []
  const generator: EffectGenerator = {
    download: () => 'whole',
    ready: () => ready,
    async generate(request) {
      requests.push(request)
      if (request.prompt.includes('fail')) throw new Error('The effects generator stopped.')
      const samples = new Int16Array(Math.round(length * 1000))
      samples.forEach((_, i) => (samples[i] = Math.round(8000 * Math.sin(i / 20))))
      const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
      return { wav: writeWav({ format, data: new Uint8Array(samples.buffer) }), seed: request.seed }
    },
    close: async () => {},
  }
  return { generator, requests }
}

function fakeHealth() {
  const calls: string[] = []
  const health: Pick<EffectHealthStore, 'record' | 'clear'> = {
    record: async (_file, _model, failure) => void calls.push(`record ${failure.error}`),
    clear: async () => void calls.push('clear'),
  }
  return { health, calls }
}

function setup(
  ready?: ReturnType<EffectGenerator['ready']>,
  list: unknown = [
    { id: 'door-creak', description: 'A slow wooden door creaks open', seconds: 3 },
    { id: 'coins', description: 'Coins spill on stone', seconds: 0.5 },
  ],
  extra: Record<string, unknown> = {},
) {
  const root = tempRepo({
    'content-studio.json': projectJson({ effects }),
    'tts/effects.json': list,
    ...extra,
  })
  const file = join(root, 'content-studio.json')
  const { generator, requests } = fakeGenerator(ready)
  const { health, calls } = fakeHealth()
  let seed = 100
  const encode: Encoder = async (_wav, out) => {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, 'mp3')
  }
  const takes = createEffectTakes({
    generator,
    health,
    encode,
    queue: createSerial(),
    now: () => 0,
    newSeed: () => seed++,
  })
  /** The view once nothing is waiting or being made. */
  async function settled(id: string) {
    for (let i = 0; i < 200; i++) {
      const view = await takes.view(file, id)
      if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
      if (!view.making.length) return view
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('takes never finished')
  }
  return { root, file, takes, requests, calls, settled }
}

describe('createEffectTakes', () => {
  it('makes takes from the description in use and the length asked, each ending where its sound ends', async () => {
    const { file, takes, requests, settled } = setup()
    expect(await takes.make(file, 'door-creak', { count: 2 })).toEqual({ ok: true })
    const view = await settled('door-creak')
    expect(requests.map((r) => [r.prompt, r.seconds, r.seed])).toEqual([
      ['A slow wooden door creaks open', 3, 100],
      ['A slow wooden door creaks open', 3, 101],
    ])
    expect(view.takes.map((t) => [t.n, t.seconds, t.chosen, t.model])).toEqual([
      [1, 1.4, false, 'Stable Audio 3 Small SFX'],
      [2, 1.4, false, 'Stable Audio 3 Small SFX'],
    ])
    expect(view.takes[0]!.peaks.length).toBeGreaterThan(10)
    expect(view.generator).toEqual({ ok: true })
  })

  it('makes takes from the studio’s own words when they are in use', async () => {
    const { file, takes, requests, settled } = setup(undefined, undefined, {
      '.content-studio/effects.json': {
        coins: { words: 'Coins on glass', gameWas: 'Coins spill on stone' },
      },
    })
    await takes.make(file, 'coins', { count: 1 })
    await settled('coins')
    expect(requests[0]!.prompt).toBe('Coins on glass')
  })

  it('shows a take being made and the next waiting, in turn', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const inner = fakeGenerator()
    const slow: EffectGenerator = {
      ...inner.generator,
      generate: async (request, signal) => {
        await gate
        return inner.generator.generate(request, signal)
      },
    }
    const root = tempRepo({
      'content-studio.json': projectJson({ effects }),
      'tts/effects.json': [{ id: 'coins', description: 'Coins', seconds: 0.5 }],
    })
    const file = join(root, 'content-studio.json')
    const takes = createEffectTakes({ generator: slow, queue: createSerial(), newSeed: () => 1 })
    await takes.make(file, 'coins', { count: 2 })
    const view = await takes.view(file, 'coins')
    if (!view || !('making' in view)) throw new Error('expected a view')
    expect(view.making.map((m) => [m.n, m.state])).toEqual([
      [1, 'making'],
      [2, 'waiting'],
    ])
    expect(await takes.making(file)).toEqual({ coins: { takes: 2, left: expect.any(Number) } })
    release()
  })

  it('never reuses a take number, and the second batch continues the first', async () => {
    const { file, takes, settled } = setup()
    await takes.make(file, 'coins', { count: 2 })
    await settled('coins')
    await takes.make(file, 'coins', { count: 1 })
    expect((await settled('coins')).takes.map((t) => t.n)).toEqual([1, 2, 3])
  })

  it('keeps a failed take with its reason, remakes it on Try again, and keeps the others', async () => {
    const { file, takes, calls, settled } = setup(undefined, [
      { id: 'coins', description: 'fail once', seconds: 0.5 },
    ])
    await takes.make(file, 'coins', { count: 1 })
    const failed = await settled('coins')
    expect(failed.failed).toEqual([{ n: 1, message: 'The effects generator stopped.' }])
    expect(calls).toEqual(['record The effects generator stopped.'])
    expect(await takes.make(file, 'coins', { retry: 2 })).toMatchObject({ ok: false })
    expect(await takes.make(file, 'coins', { retry: 1 })).toEqual({ ok: true })
    await settled('coins')
    // The description still says "fail", so it fails again, and is shown again.
    expect((await takes.view(file, 'coins')) as object).toMatchObject({
      failed: [{ n: 1 }],
      takes: [],
    })
  })

  it('records a success with the health store', async () => {
    const { file, takes, calls, settled } = setup()
    await takes.make(file, 'coins', { count: 1 })
    await settled('coins')
    expect(calls).toEqual(['clear'])
  })

  it('refuses to make takes when the model is not ready, and says why', async () => {
    const ready = {
      ok: false as const,
      message: 'Stable Audio 3 Small SFX is not on this computer.',
    }
    const { file, takes } = setup(ready)
    expect(await takes.make(file, 'coins', { count: 1 })).toEqual({
      ok: false,
      message: ready.message,
    })
    expect(await takes.view(file, 'coins')).toMatchObject({ generator: ready })
  })

  it('stops every take: the one being made ends and is discarded, the waiting ones never start', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const inner = fakeGenerator()
    const slow: EffectGenerator = {
      ...inner.generator,
      generate: (_request, signal) =>
        new Promise((_, reject) => {
          signals.push(signal)
          signal?.addEventListener('abort', () =>
            reject(new Error('The effects generator was stopped.')),
          )
        }),
    }
    const root = tempRepo({
      'content-studio.json': projectJson({ effects }),
      'tts/effects.json': [{ id: 'coins', description: 'Coins', seconds: 0.5 }],
    })
    const file = join(root, 'content-studio.json')
    const { health, calls } = fakeHealth()
    const takes = createEffectTakes({
      generator: slow,
      health,
      queue: createSerial(),
      newSeed: () => 1,
    })
    await takes.make(file, 'coins', { count: 3 })
    for (let i = 0; i < 200 && !signals.length; i++) await new Promise((r) => setTimeout(r, 5))
    expect(await takes.stop(file, 'coins')).toEqual({ ok: true, stopped: 3 })
    expect(signals[0]?.aborted).toBe(true)
    expect(await takes.view(file, 'coins')).toMatchObject({ takes: [], making: [], failed: [] })
    await new Promise((r) => setTimeout(r, 20))
    expect(signals).toHaveLength(1)
    // A stopped take is not a failure of the model.
    expect(calls).toEqual([])
  })

  it('chooses a take: the clip, the manifest and the lock are written, and the take is shown as chosen', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'door-creak', { count: 2 })
    const view = await settled('door-creak')
    expect(await takes.choose(file, 'door-creak', view.takes[1]!.file)).toEqual({ ok: true })
    expect(readFileSync(join(root, 'audio/effects/door-creak.mp3'), 'utf8')).toBe('mp3')
    const lock = JSON.parse(readFileSync(join(root, 'audio/effects.lock.json'), 'utf8'))
    expect(lock['door-creak']).toMatchObject({ take: 2, model: 'small-sfx', seed: 101 })
    expect(JSON.parse(readFileSync(join(root, 'audio/effects/manifest.json'), 'utf8'))).toEqual({
      'door-creak': { file: 'door-creak.mp3', duration: 1.4 },
    })
    const after = await settled('door-creak')
    expect(after.takes.map((t) => [t.n, t.chosen])).toEqual([
      [1, false],
      [2, true],
    ])
    // Choosing another puts the first back among the takes.
    await takes.choose(file, 'door-creak', after.takes[0]!.file)
    expect((await settled('door-creak')).takes.map((t) => [t.n, t.chosen])).toEqual([
      [1, true],
      [2, false],
    ])
  })

  it('refuses to choose a take that is not on the board', async () => {
    const { file, takes } = setup()
    expect(await takes.choose(file, 'coins', '0123456789abcdef.9.wav')).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
    expect(await takes.choose(file, 'no-such', 'x')).toBeNull()
  })

  it('drops a take that is not chosen, and refuses the chosen one', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'coins', { count: 2 })
    const view = await settled('coins')
    await takes.choose(file, 'coins', view.takes[0]!.file)
    expect(await takes.drop(file, 'coins', view.takes[0]!.file)).toEqual({
      ok: false,
      message: 'That take is the one in the game; choose another first.',
    })
    expect(await takes.drop(file, 'coins', view.takes[1]!.file)).toEqual({ ok: true })
    expect((await settled('coins')).takes.map((t) => t.n)).toEqual([1])
    expect(readdirSync(join(root, '.content-studio/effect-takes/coins'))).toHaveLength(1)
    expect(await takes.drop(file, 'coins', view.takes[1]!.file)).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
  })

  it('refuses to drop while the lock cannot be read, and shows the lock as unread', async () => {
    const { file, takes, settled } = setup(undefined, undefined, {
      'audio/effects.lock.json': '{ nope',
    })
    await takes.make(file, 'coins', { count: 1 })
    const view = await settled('coins')
    expect(view.lockUnread).toBe(true)
    expect(await takes.drop(file, 'coins', view.takes[0]!.file)).toEqual({
      ok: false,
      message: 'The sound effects lock could not be read.',
    })
  })

  it('un-chooses: the clip and the lock entry go, the take stays', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'coins', { count: 1 })
    const view = await settled('coins')
    await takes.choose(file, 'coins', view.takes[0]!.file)
    expect(await takes.unchoose(file, 'coins')).toEqual({ ok: true })
    expect(existsSync(join(root, 'audio/effects/coins.mp3'))).toBe(false)
    expect((await settled('coins')).takes.map((t) => [t.n, t.chosen])).toEqual([[1, false]])
    expect(await takes.unchoose(file, 'coins')).toEqual({
      ok: false,
      message: 'No take is chosen for this effect.',
    })
  })

  it('accepts a changed description, and refuses a changed length', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'coins', { count: 1 })
    const view = await settled('coins')
    await takes.choose(file, 'coins', view.takes[0]!.file)
    writeFileSync(
      join(root, '.content-studio/effects.json'),
      JSON.stringify({ coins: { words: 'Coins on glass', gameWas: 'Coins spill on stone' } }),
    )
    expect(await takes.accept(file, 'coins')).toEqual({ ok: true })
    expect(
      JSON.parse(readFileSync(join(root, 'audio/effects.lock.json'), 'utf8')).coins.inputs,
    ).toEqual({
      description: 'Coins on glass',
      seconds: 0.5,
    })
    writeFileSync(
      join(root, 'tts/effects.json'),
      JSON.stringify([{ id: 'coins', description: 'Coins spill on stone', seconds: 2 }]),
    )
    expect(await takes.accept(file, 'coins')).toMatchObject({ ok: false })
  })

  it('serves only a take’s own WAV', async () => {
    const { file, takes, settled } = setup()
    await takes.make(file, 'coins', { count: 1 })
    const view = await settled('coins')
    const path = await takes.takeFile(file, 'coins', view.takes[0]!.file)
    expect(wavSeconds(readWav(new Uint8Array(await Bun.file(path!).arrayBuffer())))).toBe(1.4)
    expect(await takes.takeFile(file, 'coins', '../../content-studio.json')).toBeNull()
    expect(await takes.takeFile(file, 'coins', '0123456789abcdef.9.wav')).toBeNull()
    expect(await takes.takeFile(file, '../x', view.takes[0]!.file)).toBeNull()
  })

  it('keeps takes made for an earlier description, and shows only current failures', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'coins', { count: 1 })
    await settled('coins')
    writeFileSync(
      join(root, '.content-studio/effects.json'),
      JSON.stringify({ coins: { words: 'Coins on glass', gameWas: 'Coins spill on stone' } }),
    )
    await takes.make(file, 'coins', { count: 1 })
    expect((await settled('coins')).takes.map((t) => t.n)).toEqual([1, 2])
  })
})
