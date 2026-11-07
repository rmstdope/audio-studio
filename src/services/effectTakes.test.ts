import { describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { wavSeconds } from '../core/musicTake'
import { readWav, writeWav } from '../core/wav'
import type { Encoder } from './audio'
import { createEffectTakes, effectTakeHash } from './effectTakes'
import type { EffectGenerator, EffectReady, EffectRequest } from './effects'
import type { EffectModelId } from '../core/effectModels'
import type { ImageDownload } from '../core/imageModels'
import { holdGpu } from './gpu'
import type { EffectHealthStore } from './effectHealth'
import { createSerial, type Serial } from './serial'

const effects = {
  from: { shared: 'tts/effects.json' },
  clips: 'audio/effects',
  manifest: 'audio/effects/manifest.json',
}

/** A generator that makes a tone `length` seconds long (shorter than asked, as the model does), and fails for a description saying "fail". */
function fakeGenerator(
  ready: EffectReady = { ok: true },
  length = 1.4,
  /** Per model, what differs from a model that is here and ready. */
  models: Partial<Record<EffectModelId, { ready?: EffectReady; download?: ImageDownload }>> = {},
  /** Seconds of silence at the start and end of each one-shot take. */
  silence: { lead: number; tail: number } = { lead: 0, tail: 0 },
) {
  const requests: (EffectRequest & { model: EffectModelId })[] = []
  const generator: EffectGenerator = {
    download: (model) => models[model]?.download ?? 'whole',
    ready: (model) => models[model]?.ready ?? ready,
    async generate(request) {
      requests.push(request)
      if (request.prompt.includes('fail')) throw new Error('The effects generator stopped.')
      const samples = new Int16Array(Math.round(length * 1000))
      samples.forEach((_, i) => {
        const quiet = i < silence.lead * 1000 || i >= samples.length - silence.tail * 1000
        samples[i] = quiet ? 0 : Math.round(8000 * Math.sin(i / 20))
      })
      const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
      return { wav: writeWav({ format, data: new Uint8Array(samples.buffer) }), seed: request.seed }
    },
    close: async () => {},
  }
  return { generator, requests }
}

function fakeHealth(failed: EffectModelId[] = []) {
  const calls: string[] = []
  const health: Pick<EffectHealthStore, 'read' | 'record' | 'clear'> = {
    read: async () =>
      Object.fromEntries(failed.map((id) => [id, { error: 'x', at: '' }])) as Awaited<
        ReturnType<EffectHealthStore['read']>
      >,
    record: async (_file, model, failure) =>
      void calls.push(`record ${model} ${failure.error} on ${failure.effect}`),
    // Slower than a poll of the view, as a store on a loaded disk can be: a take counts as
    // made only once its model's failure is cleared.
    clear: async (_file, model) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      calls.push(`clear ${model}`)
    },
  }
  return { health, calls }
}

function setup(
  ready?: EffectReady,
  list: unknown = [
    { id: 'door-creak', text: 'A slow wooden door creaks open', seconds: 3 },
    { id: 'coins', text: 'Coins spill on stone', seconds: 0.5 },
  ],
  extra: Record<string, unknown> = {},
  length = 1.4,
  options: {
    models?: Parameters<typeof fakeGenerator>[2]
    failed?: EffectModelId[]
    main?: EffectModelId
    gpu?: ReturnType<typeof createSerial>
    encode?: Encoder
    silence?: { lead: number; tail: number }
  } = {},
) {
  const root = tempRepo({
    'content-studio.json': projectJson({
      effects: options.main ? { ...effects, model: options.main } : effects,
    }),
    'tts/effects.json': list,
    ...extra,
  })
  const file = join(root, 'content-studio.json')
  const { generator, requests } = fakeGenerator(ready, length, options.models, options.silence)
  const { health, calls } = fakeHealth(options.failed)
  let seed = 100
  // The sound each choice was encoded from.
  const encoded: Uint8Array[] = []
  const encode: Encoder =
    options.encode ??
    (async (wav, out) => {
      encoded.push(wav)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, 'mp3')
    })
  const takes = createEffectTakes({
    generator,
    health,
    encode,
    queue: createSerial(),
    gpu: options.gpu ?? createSerial(),
    hasUv: () => true,
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
  return { root, file, takes, requests, calls, settled, encoded }
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
    expect(view.canMake).toBe(true)
  })

  it('makes takes from the studio’s own words when they are in use', async () => {
    const { file, takes, requests, settled } = setup(undefined, undefined, {
      'content-studio/effects/edits.json': {
        coins: { text: 'Coins on glass', gameWas: 'Coins spill on stone' },
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
      'tts/effects.json': [{ id: 'coins', text: 'Coins', seconds: 0.5 }],
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
      { id: 'coins', text: 'fail once', seconds: 0.5 },
    ])
    await takes.make(file, 'coins', { count: 1 })
    const failed = await settled('coins')
    expect(failed.failed).toEqual([{ n: 1, message: 'The effects generator stopped.' }])
    expect(calls).toEqual(['record small-sfx The effects generator stopped. on coins'])
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
    expect(calls).toEqual(['clear small-sfx'])
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
    expect(await takes.view(file, 'coins')).toMatchObject({ canMake: false })
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
      'tts/effects.json': [{ id: 'coins', text: 'Coins', seconds: 0.5 }],
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

  /**
   * A take of `coins` made up to the moment its WAV is written, with the effect's board turn held
   * there; `release` lets the board be saved.
   */
  async function heldAtTheBoard() {
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    const inner = fakeGenerator()
    const generator: EffectGenerator = {
      ...inner.generator,
      generate: async (request, signal) => {
        await gate
        return inner.generator.generate(request, signal)
      },
    }
    const root = tempRepo({
      'content-studio.json': projectJson({ effects }),
      'tts/effects.json': [{ id: 'coins', text: 'Coins', seconds: 0.5 }],
    })
    const file = join(root, 'content-studio.json')
    const { health, calls } = fakeHealth()
    const takes = createEffectTakes({ generator, health, queue: createSerial(), newSeed: () => 1 })
    await takes.make(file, 'coins', { count: 1 })
    // The board turn is the studio's own, kept on globalThis; it is held while the take finishes.
    const boards = (globalThis as unknown as { contentStudioEffectBoards: Serial })
      .contentStudioEffectBoards
    let release: () => void = () => {}
    void boards.run(`${file}\0coins`, () => new Promise<void>((resolve) => (release = resolve)))
    open()
    const folder = join(root, 'content-studio/cache/effect-takes/coins')
    for (let i = 0; i < 400; i++) {
      if (existsSync(folder) && readdirSync(folder).some((name) => name.endsWith('.wav'))) break
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(readdirSync(folder).some((name) => name.endsWith('.wav'))).toBe(true)
    const done = async () => {
      for (let i = 0; i < 400; i++) {
        const view = await takes.view(file, 'coins')
        if (view && 'ok' in view && view.ok && !view.making.length) return view
        await new Promise((r) => setTimeout(r, 5))
      }
      throw new Error('the take never finished')
    }
    return { root, file, takes, calls, release: () => release(), done }
  }

  it('leaves the model’s last failure as it was when the take is stopped after its WAV is written', async () => {
    const held = await heldAtTheBoard()
    expect(await held.takes.stop(held.file, 'coins')).toEqual({ ok: true, stopped: 1 })
    held.release()
    await held.done()
    await new Promise((r) => setTimeout(r, 40))
    expect(held.calls).toEqual([])
  })

  it('records the model as failed when the board cannot be saved after the WAV is written', async () => {
    const held = await heldAtTheBoard()
    writeFileSync(join(held.root, 'content-studio/cache/effect-boards/coins.json'), '{ nope')
    held.release()
    for (let i = 0; i < 400 && !held.calls.some((c) => c.startsWith('record')); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    await new Promise((r) => setTimeout(r, 40))
    expect(held.calls.at(-1)).toBe(
      'record small-sfx content-studio/cache/effect-boards/coins.json cannot be used. on coins',
    )
  })

  it('chooses a take: the clip, the manifest and the lock are written, and the take is shown as chosen', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'door-creak', { count: 2 })
    const view = await settled('door-creak')
    expect(await takes.choose(file, 'door-creak', view.takes[1]!.file)).toEqual({ ok: true })
    expect(readFileSync(join(root, 'audio/effects/door-creak.mp3'), 'utf8')).toBe('mp3')
    const lock = JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))
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
    expect(readdirSync(join(root, 'content-studio/cache/effect-takes/coins'))).toHaveLength(1)
    expect(await takes.drop(file, 'coins', view.takes[1]!.file)).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
  })

  it('refuses to drop while the lock cannot be read, and shows the lock as unread', async () => {
    const { file, takes, settled } = setup(undefined, undefined, {
      'content-studio/effects/lock.json': '{ nope',
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
    const edits = join(root, 'content-studio/effects/edits.json')
    mkdirSync(dirname(edits), { recursive: true })
    writeFileSync(
      edits,
      JSON.stringify({ coins: { text: 'Coins on glass', gameWas: 'Coins spill on stone' } }),
    )
    expect(await takes.accept(file, 'coins')).toEqual({ ok: true })
    expect(
      JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8')).coins.inputs,
    ).toEqual({
      text: 'Coins on glass',
      seconds: 0.5,
    })
    writeFileSync(
      join(root, 'tts/effects.json'),
      JSON.stringify([{ id: 'coins', text: 'Coins spill on stone', seconds: 2 }]),
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
    const edits = join(root, 'content-studio/effects/edits.json')
    mkdirSync(dirname(edits), { recursive: true })
    writeFileSync(
      edits,
      JSON.stringify({ coins: { text: 'Coins on glass', gameWas: 'Coins spill on stone' } }),
    )
    await takes.make(file, 'coins', { count: 1 })
    expect((await settled('coins')).takes.map((t) => t.n)).toEqual([1, 2])
  })

  it('goes on after a reload: a second service on the same process sees the batch being made', async () => {
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
      'tts/effects.json': [{ id: 'coins', text: 'Coins', seconds: 0.5 }],
    })
    const file = join(root, 'content-studio.json')
    const before = createEffectTakes({ generator: slow, queue: createSerial(), newSeed: () => 1 })
    await before.make(file, 'coins', { count: 2 })
    // A reload makes a new service; what is being made belongs to the process, not to it.
    const after = createEffectTakes({ generator: slow, queue: createSerial(), newSeed: () => 1 })
    expect(await after.making(file)).toMatchObject({ coins: { takes: 2 } })
    const view = await after.view(file, 'coins')
    expect(view).toMatchObject({ making: [{ n: 1 }, { n: 2 }] })
    release()
  })
})

describe('two models', () => {
  it('shows the project’s model, each model’s state and uv on the page', async () => {
    const { file, takes } = setup(undefined, undefined, {}, undefined, {
      main: 'open-1',
      models: { 'small-sfx': { download: 'partial' } },
      failed: ['open-1'],
    })
    expect(await takes.view(file, 'coins')).toMatchObject({
      canMake: true,
      projectModel: 'open-1',
      uv: true,
      models: [
        { id: 'small-sfx', download: 'partial', failed: false },
        { id: 'open-1', download: 'whole', failed: true },
      ],
    })
  })

  it('makes a take with the model asked for, names it, and clears that model’s failure', async () => {
    const { file, takes, requests, calls, settled } = setup()
    expect(await takes.make(file, 'coins', { count: 1, model: 'open-1' })).toEqual({ ok: true })
    const view = await settled('coins')
    expect(requests.map((r) => r.model)).toEqual(['open-1'])
    expect(view.takes.map((t) => t.model)).toEqual(['Stable Audio Open 1.0'])
    expect(calls).toEqual(['clear open-1'])
  })

  it('starts on the project’s model, and on the other when the project’s cannot run', async () => {
    const first = setup()
    await first.takes.make(first.file, 'coins', { count: 1 })
    await first.settled('coins')
    expect(first.requests.map((r) => r.model)).toEqual(['small-sfx'])
    const absent = setup(undefined, undefined, {}, undefined, {
      models: { 'small-sfx': { download: 'absent' } },
    })
    await absent.takes.make(absent.file, 'coins', { count: 1 })
    await absent.settled('coins')
    expect(absent.requests.map((r) => r.model)).toEqual(['open-1'])
    const failed = setup(undefined, undefined, {}, undefined, {
      main: 'open-1',
      failed: ['open-1'],
    })
    await failed.takes.make(failed.file, 'coins', { count: 1 })
    await failed.settled('coins')
    expect(failed.requests.map((r) => r.model)).toEqual(['small-sfx'])
  })

  it('refuses a model that cannot run, with the generator’s reason', async () => {
    const reason = 'Stable Audio Open 1.0 is not on this computer.'
    const { file, takes } = setup(undefined, undefined, {}, undefined, {
      models: { 'open-1': { ready: { ok: false, message: reason } } },
    })
    expect(await takes.make(file, 'coins', { count: 1, model: 'open-1' })).toEqual({
      ok: false,
      message: reason,
    })
  })

  it('cannot make anything when neither model can run', async () => {
    const no = { ok: false as const, message: 'nope' }
    const { file, takes } = setup(no)
    expect(await takes.view(file, 'coins')).toMatchObject({ canMake: false })
  })

  it('remakes a failed take with the model it was asked with, and records the failure per model', async () => {
    const { file, takes, requests, calls, settled } = setup(undefined, [
      { id: 'coins', text: 'fail once', seconds: 0.5 },
    ])
    await takes.make(file, 'coins', { count: 1, model: 'open-1' })
    await settled('coins')
    expect(calls).toEqual(['record open-1 The effects generator stopped. on coins'])
    await takes.make(file, 'coins', { retry: 1 })
    await settled('coins')
    expect(requests.map((r) => r.model)).toEqual(['open-1', 'open-1'])
  })

  it('makes Open 1.0 takes on the GPU queue, behind other jobs, saying what it waits for', async () => {
    const gpu = createSerial()
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    // A music take holds the chip.
    void gpu.run('gpu', () => holdGpu('music', () => gate))
    const { file, takes, settled } = setup(undefined, undefined, {}, undefined, { gpu })
    await takes.make(file, 'coins', { count: 3, model: 'open-1' })
    const view = await takes.view(file, 'coins')
    if (!view || !('making' in view)) throw new Error('expected a view')
    expect(view.making.map((m) => [m.n, m.state, m.model, m.expected, m.chip])).toEqual([
      [1, 'waiting', 'Stable Audio Open 1.0', 100, { using: 'music' }],
      [2, 'waiting', 'Stable Audio Open 1.0', 100, undefined],
      [3, 'waiting', 'Stable Audio Open 1.0', 100, undefined],
    ])
    expect(await takes.making(file)).toEqual({ coins: { takes: 3, left: 300 } })
    release()
    expect((await settled('coins')).takes).toHaveLength(3)
  })

  it('keeps Small SFX takes off the GPU queue', async () => {
    const gpu = createSerial()
    const gate = new Promise<void>(() => {})
    void gpu.run('gpu', () => gate)
    const { file, takes, settled } = setup(undefined, undefined, {}, undefined, { gpu })
    await takes.make(file, 'coins', { count: 1, model: 'small-sfx' })
    expect((await settled('coins')).takes).toHaveLength(1)
  })
})

describe('readEffects with a lock', () => {
  it('reads each effect’s chosen take, whether its clip is there, and which have takes', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'coins', { count: 1 })
    const view = await settled('coins')
    await takes.choose(file, 'coins', view.takes[0]!.file)
    await takes.make(file, 'door-creak', { count: 1 })
    await settled('door-creak')
    const { loadProject } = await import('./workspace')
    const summary = (await loadProject(file)) as {
      summary: { effects: { rows: { id: string; status: string }[] } }
    }
    expect(summary.summary.effects.rows.map((r) => [r.id, r.status])).toEqual([
      ['door-creak', 'not-chosen'],
      ['coins', 'chosen'],
    ])
    rmSync(join(root, 'audio/effects/coins.mp3'))
    const again = (await loadProject(file)) as typeof summary
    expect(again.summary.effects.rows[1]!.status).toBe('missing')
  })
})

describe('takes of an effect that loops', () => {
  const rain = { id: 'rain', text: 'Steady rain on a tin roof', seconds: 10, loops: true }
  const rainy = (length: number) => setup(undefined, [rain], {}, length)

  it('asks for the length, the seam and a spare second, and keeps a take exactly the length asked', async () => {
    const { file, takes, requests, settled } = rainy(12)
    await takes.make(file, 'rain', { count: 1 })
    const view = await settled('rain')
    expect(requests.map((r) => r.seconds)).toEqual([12])
    expect(view.takes).toMatchObject([{ n: 1, seconds: 10, loops: true, quietAt: null }])
  })

  it('shades a take whose sound stops early: padded to the length, and where it goes quiet', async () => {
    const { file, root, takes, settled } = rainy(6.2)
    await takes.make(file, 'rain', { count: 1 })
    const view = await settled('rain')
    expect(view.takes[0]).toMatchObject({ seconds: 10, loops: true, quietAt: 6.2 })
    const board = JSON.parse(
      readFileSync(join(root, 'content-studio/cache/effect-boards/rain.json'), 'utf8'),
    )
    expect(board.takes[0]).toMatchObject({ quietAt: 6.2, inputs: { loops: true, seconds: 10 } })
    const wav = readWav(
      new Uint8Array(
        readFileSync(join(root, 'content-studio/cache/effect-takes/rain', view.takes[0]!.file)),
      ),
    )
    expect(wavSeconds(wav)).toBe(10)
  })

  it('is not asked for more than the length for a one-shot, and its take plays once', async () => {
    const { file, takes, requests, settled } = setup()
    await takes.make(file, 'door-creak', { count: 1 })
    const view = await settled('door-creak')
    expect(requests[0]!.seconds).toBe(3)
    expect(view.takes[0]).toMatchObject({ loops: false, quietAt: null })
  })

  it('keeps the hash of a one-shot as it was, and gives a loop another', () => {
    const once = { description: 'x', seconds: 3 }
    expect(effectTakeHash({ ...once, loops: false })).toBe(effectTakeHash(once))
    expect(effectTakeHash({ ...once, loops: true })).not.toBe(effectTakeHash(once))
  })

  it('refuses to choose a take made the other way, and chooses one made the right way', async () => {
    const { file, takes, settled, root } = rainy(12)
    await takes.make(file, 'rain', { count: 1 })
    const first = (await settled('rain')).takes[0]!
    expect(await takes.choose(file, 'rain', first.file)).toEqual({ ok: true })
    // The game makes the effect play once: the loop take can no longer be chosen again.
    writeFileSync(
      join(root, 'tts/effects.json'),
      JSON.stringify([{ id: 'rain', text: rain.text, seconds: 10 }]),
    )
    const refused = await takes.choose(file, 'rain', first.file)
    expect(refused).toEqual({
      ok: false,
      message: "Take 1 was made to loop, so it can't be chosen for an effect that plays once.",
    })
    await takes.make(file, 'rain', { count: 1 })
    const view = await settled('rain')
    expect(view.takes.map((t) => [t.n, t.loops])).toEqual([
      [1, true],
      [2, false],
    ])
    expect(await takes.choose(file, 'rain', view.takes[1]!.file)).toEqual({ ok: true })
    const lock = JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))
    expect(lock.rain.inputs.loops).toBeUndefined()
    expect(lock.rain.take).toBe(2)
  })

  it('records loops in the lock when a looping take is chosen, and the manifest keeps the game’s length', async () => {
    const { file, takes, settled, root } = rainy(12)
    await takes.make(file, 'rain', { count: 1 })
    const first = (await settled('rain')).takes[0]!
    await takes.choose(file, 'rain', first.file)
    const lock = JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))
    expect(lock.rain.inputs).toEqual({ text: rain.text, seconds: 10, loops: true })
    const manifest = JSON.parse(readFileSync(join(root, 'audio/effects/manifest.json'), 'utf8'))
    expect(manifest.rain.duration).toBe(10)
  })

  it('counts an effect whose play changed as changed since chosen, and refuses to accept it', async () => {
    const { file, takes, settled, root } = rainy(12)
    await takes.make(file, 'rain', { count: 1 })
    await takes.choose(file, 'rain', (await settled('rain')).takes[0]!.file)
    writeFileSync(
      join(root, 'tts/effects.json'),
      JSON.stringify([{ id: 'rain', text: rain.text, seconds: 10 }]),
    )
    const accepted = await takes.accept(file, 'rain')
    expect(accepted).toEqual({
      ok: false,
      message: 'A change of how the effect plays cannot be accepted: the effect needs a new take.',
    })
  })
})

describe('fades of a sound effect take', () => {
  const fades = { in: 0.1, out: 0.2, shape: 'straight' as const }
  const lockFile = 'content-studio/effects/lock.json'
  const manifestFile = 'audio/effects/manifest.json'

  /** An encoder that keeps the sound it was given as the clip's bytes, so a test can read what the game would play. */
  const keeping: Encoder = async (wav, out) => {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, wav)
  }
  /** Sets up with one door take made (1.4 s at 1000 Hz). */
  async function withTake(options: Parameters<typeof setup>[4] = {}, list?: unknown) {
    const made = setup(undefined, list, {}, 1.4, { encode: keeping, ...options })
    await made.takes.make(made.file, 'door-creak', { count: 2 })
    const view = await made.settled('door-creak')
    return { ...made, view, take: view.takes[0]! }
  }
  const clip = (root: string) =>
    readWav(new Uint8Array(readFileSync(join(root, 'audio/effects/door-creak.mp3'))))
  const sampleAt = (wav: ReturnType<typeof readWav>, frame: number) =>
    new Int16Array(wav.data.buffer, wav.data.byteOffset, wav.data.length / 2)[frame]!

  it('saves the fades with the take and shows them; the sound on the board stays as made', async () => {
    const { root, file, takes, take, settled } = await withTake()
    const before = readFileSync(
      join(root, 'content-studio/cache/effect-takes/door-creak', take.file),
    )
    expect(await takes.setFades(file, 'door-creak', take.file, fades)).toEqual({ ok: true })
    const view = await settled('door-creak')
    expect(view.takes[0]!.fades).toEqual(fades)
    expect(view.takes[1]!.fades).toBeUndefined()
    expect(
      readFileSync(join(root, 'content-studio/cache/effect-takes/door-creak', take.file)),
    ).toEqual(before)
  })

  it('removes them with null, and treats lengths of 0 as none', async () => {
    const { file, takes, take, settled } = await withTake()
    await takes.setFades(file, 'door-creak', take.file, fades)
    expect(await takes.setFades(file, 'door-creak', take.file, null)).toEqual({ ok: true })
    expect((await settled('door-creak')).takes[0]!.fades).toBeUndefined()
    await takes.setFades(file, 'door-creak', take.file, { in: 0, out: 0, shape: 'smooth' })
    expect((await settled('door-creak')).takes[0]!.fades).toBeUndefined()
  })

  it('writes the faded sound when a take with fades is chosen, with the take’s real length in the manifest', async () => {
    const { root, file, takes, take } = await withTake()
    await takes.setFades(file, 'door-creak', take.file, fades)
    expect(await takes.choose(file, 'door-creak', take.file)).toEqual({ ok: true })
    const wav = clip(root)
    expect(sampleAt(wav, 0)).toBe(0)
    expect(Math.abs(sampleAt(wav, 1399))).toBeLessThan(100)
    // The middle is untouched: the made sound is a sine of amplitude 8000.
    expect(sampleAt(wav, 700)).toBe(Math.round(8000 * Math.sin(700 / 20)))
    expect(JSON.parse(readFileSync(join(root, manifestFile), 'utf8'))).toEqual({
      'door-creak': { file: 'door-creak.mp3', duration: 1.4 },
    })
  })

  it('chooses a take without fades exactly as made', async () => {
    const { root, file, takes, take } = await withTake()
    await takes.choose(file, 'door-creak', take.file)
    expect(readFileSync(join(root, 'audio/effects/door-creak.mp3'))).toEqual(
      readFileSync(join(root, 'content-studio/cache/effect-takes/door-creak', take.file)),
    )
  })

  it('rewrites only the game’s sound for the chosen take: the manifest and the lock stay byte for byte', async () => {
    const { root, file, takes, take } = await withTake()
    await takes.choose(file, 'door-creak', take.file)
    const lock = readFileSync(join(root, lockFile), 'utf8')
    const manifest = readFileSync(join(root, manifestFile), 'utf8')
    expect(await takes.setFades(file, 'door-creak', take.file, fades)).toEqual({ ok: true })
    expect(sampleAt(clip(root), 0)).toBe(0)
    expect(Math.abs(sampleAt(clip(root), 1399))).toBeLessThan(100)
    expect(readFileSync(join(root, lockFile), 'utf8')).toBe(lock)
    expect(readFileSync(join(root, manifestFile), 'utf8')).toBe(manifest)
    // Removing them writes the sound as made again.
    expect(await takes.setFades(file, 'door-creak', take.file, null)).toEqual({ ok: true })
    expect(sampleAt(clip(root), 1399)).toBe(Math.round(8000 * Math.sin(1399 / 20)))
  })

  it('does not touch the game’s file for a take that is not the chosen one', async () => {
    const { root, file, takes, view } = await withTake()
    await takes.choose(file, 'door-creak', view.takes[0]!.file)
    const before = readFileSync(join(root, 'audio/effects/door-creak.mp3'))
    await takes.setFades(file, 'door-creak', view.takes[1]!.file, fades)
    expect(readFileSync(join(root, 'audio/effects/door-creak.mp3'))).toEqual(before)
  })

  it('refuses lengths together longer than the take, and negative ones, changing nothing', async () => {
    const { file, takes, take, settled } = await withTake()
    expect(
      await takes.setFades(file, 'door-creak', take.file, { in: 1, out: 0.5, shape: 'smooth' }),
    ).toEqual({ ok: false, message: "The fades together can't be longer than the take (1.4 s)." })
    expect(
      await takes.setFades(file, 'door-creak', take.file, { in: -1, out: 0, shape: 'smooth' }),
    ).toEqual({ ok: false, message: 'Type a length of 0 s or more.' })
    expect((await settled('door-creak')).takes[0]!.fades).toBeUndefined()
  })

  it('refuses a take that is not on the board, and an effect that is not listed', async () => {
    const { file, takes } = await withTake()
    expect(await takes.setFades(file, 'door-creak', '0123456789abcdef.9.wav', fades)).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
    expect(await takes.setFades(file, 'no-such', 'x', fades)).toBeNull()
  })

  it('refuses a take made to loop, and any take of an effect that loops', async () => {
    const rain = { id: 'rain', text: 'Steady rain on a tin roof', seconds: 10, loops: true }
    const made = setup(undefined, [rain], {}, 12, { encode: keeping })
    await made.takes.make(made.file, 'rain', { count: 1 })
    const loop = (await made.settled('rain')).takes[0]!
    const plain = 'Only a sound that plays once can fade.'
    expect(await made.takes.setFades(made.file, 'rain', loop.file, fades)).toEqual({
      ok: false,
      message: plain,
    })
    // A take made to play once, left on an effect that now loops, cannot fade either.
    const once = setup(undefined, undefined, {}, 1.4, { encode: keeping })
    await once.takes.make(once.file, 'door-creak', { count: 1 })
    const take = (await once.settled('door-creak')).takes[0]!
    await once.takes.setFades(once.file, 'door-creak', take.file, fades)
    writeFileSync(
      join(once.root, 'tts/effects.json'),
      JSON.stringify([{ id: 'door-creak', text: 'A door', seconds: 3, loops: true }]),
    )
    expect(await once.takes.setFades(once.file, 'door-creak', take.file, fades)).toEqual({
      ok: false,
      message: plain,
    })
    // It keeps its saved fades meanwhile, and the view still carries them.
    expect((await once.settled('door-creak')).takes[0]!.fades).toEqual(fades)
  })

  it('refuses while the lock cannot be read, changing nothing', async () => {
    const { root, file, takes, take, settled } = await withTake()
    mkdirSync(join(root, 'content-studio/effects'), { recursive: true })
    writeFileSync(join(root, lockFile), '{ not json')
    const answer = await takes.setFades(file, 'door-creak', take.file, fades)
    expect(answer).toMatchObject({ ok: false })
    expect((await settled('door-creak')).takes[0]!.fades).toBeUndefined()
  })

  it('leaves the board and the game as they were when the sound cannot be encoded', async () => {
    let failing = false
    const flaky: Encoder = async (wav, out) => {
      if (failing) throw new Error('The disk is full.')
      return keeping(wav, out, { bitrate: '160k', channels: 2 })
    }
    const { root, file, takes, take, settled } = await withTake({ encode: flaky })
    await takes.choose(file, 'door-creak', take.file)
    const game = readFileSync(join(root, 'audio/effects/door-creak.mp3'))
    failing = true
    expect(await takes.setFades(file, 'door-creak', take.file, fades)).toEqual({
      ok: false,
      message: 'The disk is full.',
    })
    expect((await settled('door-creak')).takes[0]!.fades).toBeUndefined()
    expect(readFileSync(join(root, 'audio/effects/door-creak.mp3'))).toEqual(game)
  })

  it('puts the game’s file back when the board cannot be written', async () => {
    const { root, file, takes, take } = await withTake()
    await takes.choose(file, 'door-creak', take.file)
    const game = readFileSync(join(root, 'audio/effects/door-creak.mp3'))
    // A folder that takes no new file: the board cannot be written after the game's file was.
    const folder = join(root, 'content-studio/cache/effect-boards')
    chmodSync(folder, 0o555)
    const answer = await takes.setFades(file, 'door-creak', take.file, fades)
    chmodSync(folder, 0o755)
    expect(answer).toEqual({ ok: false, message: 'The take board could not be written.' })
    expect(readFileSync(join(root, 'audio/effects/door-creak.mp3'))).toEqual(game)
  })

  it('fades the chosen take without reading the manifest, which it never writes', async () => {
    const { root, file, takes, take } = await withTake()
    await takes.choose(file, 'door-creak', take.file)
    writeFileSync(join(root, manifestFile), '{ not json')
    expect(await takes.setFades(file, 'door-creak', take.file, fades)).toEqual({ ok: true })
    expect(readFileSync(join(root, manifestFile), 'utf8')).toBe('{ not json')
    expect(sampleAt(clip(root), 0)).toBe(0)
  })

  it('fades a trimmed take after the cut: the lengths are of the part left, the game gets the cut sound faded, and the cuts alone are served without fades', async () => {
    const made = setup(undefined, undefined, {}, 1.4, {
      encode: keeping,
      silence: { lead: 0.1, tail: 0.05 },
    })
    await made.takes.make(made.file, 'door-creak', { count: 1 })
    const take = (await made.settled('door-creak')).takes[0]!
    await made.takes.trim(made.file, 'door-creak', take.file, false)
    const left = (await made.settled('door-creak')).takes[0]!.trim!.seconds
    // Longer than what is left, though shorter than the take as generated.
    expect(
      await made.takes.setFades(made.file, 'door-creak', take.file, {
        in: left,
        out: 0.2,
        shape: 'smooth',
      }),
    ).toEqual({
      ok: false,
      message: `The fades together can't be longer than the take (${left.toFixed(1)} s).`,
    })
    expect(
      await made.takes.setFades(made.file, 'door-creak', take.file, {
        in: 0.1,
        out: 0.1,
        shape: 'straight',
      }),
    ).toEqual({ ok: true })
    await made.takes.choose(made.file, 'door-creak', take.file)
    const wav = clip(made.root)
    expect(wavSeconds(wav)).toBeCloseTo(left, 2)
    expect(sampleAt(wav, 0)).toBe(0)
    const cuts = readWav((await made.takes.trimmedSound(made.file, 'door-creak', take.file))!)
    // Halfway into the fade-in the cuts alone are louder than the game's faded sound.
    expect(Math.abs(sampleAt(cuts, 50))).toBeGreaterThan(Math.abs(sampleAt(wav, 50)))
  })

  it('drops the fades with the take', async () => {
    const { root, file, takes, take } = await withTake()
    await takes.setFades(file, 'door-creak', take.file, fades)
    expect(await takes.drop(file, 'door-creak', take.file)).toEqual({ ok: true })
    const board = JSON.parse(
      readFileSync(join(root, 'content-studio/cache/effect-boards/door-creak.json'), 'utf8'),
    )
    expect(JSON.stringify(board)).not.toContain('"fades"')
  })
})

describe('Trim silence on an effect take', () => {
  const quiet = { silence: { lead: 0.1, tail: 0.05 } }
  const door = (silence?: { lead: number; tail: number }) =>
    setup(undefined, undefined, {}, 1.4, silence ? { silence } : {})
  const board = (root: string, id: string) =>
    JSON.parse(readFileSync(join(root, `content-studio/cache/effect-boards/${id}.json`), 'utf8'))
  const manifest = (root: string) =>
    JSON.parse(readFileSync(join(root, 'audio/effects/manifest.json'), 'utf8'))
  const lock = (root: string) =>
    JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))

  async function made(ctx: ReturnType<typeof setup>, id = 'door-creak') {
    await ctx.takes.make(ctx.file, id, { count: 1 })
    return (await ctx.settled(id)).takes[0]!
  }

  it('says what a take has to cut, and nothing of a loop’s take', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    expect(take.trimmable).toBe('cut')
    expect(take.trim).toBeUndefined()
    const flat = door()
    expect((await made(flat)).trimmable).toBe('nothing')
    const rain = setup(undefined, [{ id: 'rain', text: 'Rain', seconds: 10, loops: true }], {}, 12)
    expect((await made(rain, 'rain')).trimmable).toBeUndefined()
  })

  it('says a take with no sound is near-silent throughout', async () => {
    const ctx = setup(undefined, undefined, {}, 1.4, { silence: { lead: 1.4, tail: 0 } })
    expect((await made(ctx)).trimmable).toBe('silent')
  })

  it('cuts the near-silence, keeps the WAV as generated and the cut with the take', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    const path = join(ctx.root, 'content-studio/cache/effect-takes/door-creak', take.file)
    const before = readFileSync(path)
    expect(await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)).toEqual({ ok: true })
    expect(readFileSync(path).equals(before)).toBe(true)
    const trimmed = (await ctx.settled('door-creak')).takes[0]!
    expect(trimmed.trimmable).toBeUndefined()
    expect(trimmed.trim!.start).toBeCloseTo(0.09, 2)
    expect(trimmed.trim!.end).toBeCloseTo(0.04, 2)
    expect(trimmed.trim!.seconds).toBeCloseTo(1.4 - 0.13, 2)
    expect(board(ctx.root, 'door-creak').takes[0].trim.start).toBeCloseTo(0.09, 2)
    // The part between the cuts is what plays.
    const part = readWav((await ctx.takes.trimmedSound(ctx.file, 'door-creak', take.file))!)
    expect(wavSeconds(part)).toBeCloseTo(1.27, 2)
  })

  it('gives the take back as generated on Undo trim', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)
    expect(await ctx.takes.trim(ctx.file, 'door-creak', take.file, true)).toEqual({ ok: true })
    const back = (await ctx.settled('door-creak')).takes[0]!
    expect(back.trim).toBeUndefined()
    expect(back.trimmable).toBe('cut')
    expect(board(ctx.root, 'door-creak').takes[0].trim).toBeUndefined()
    expect(await ctx.takes.trimmedSound(ctx.file, 'door-creak', take.file)).toBeNull()
    expect(await ctx.takes.trim(ctx.file, 'door-creak', take.file, true)).toEqual({
      ok: false,
      message: 'That take is not trimmed.',
    })
  })

  it('refuses a take with nothing to cut or no sound, with the reasons the page greys it out by', async () => {
    const flat = door()
    const a = await made(flat)
    expect(await flat.takes.trim(flat.file, 'door-creak', a.file, false)).toEqual({
      ok: false,
      message: 'Starts and ends on its sound: nothing to cut.',
    })
    const silent = setup(undefined, undefined, {}, 1.4, { silence: { lead: 1.4, tail: 0 } })
    const b = await made(silent)
    expect(await silent.takes.trim(silent.file, 'door-creak', b.file, false)).toEqual({
      ok: false,
      message: 'Near-silent throughout: there is no sound to keep.',
    })
  })

  it('refuses a take that is not on the board, and one whose sound cannot be read', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    expect(await ctx.takes.trim(ctx.file, 'door-creak', '0123456789abcdef.9.wav', false)).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
    writeFileSync(
      join(ctx.root, 'content-studio/cache/effect-takes/door-creak', take.file),
      'not a wav',
    )
    expect(await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)).toEqual({
      ok: false,
      message: 'The take’s sound file could not be read.',
    })
    expect(await ctx.takes.trim(ctx.file, 'no-such', take.file, false)).toBeNull()
  })

  it('refuses a take made to loop, and a take made to play once on an effect that loops', async () => {
    const rain = setup(undefined, [{ id: 'rain', text: 'Rain', seconds: 10, loops: true }], {}, 12)
    const loop = await made(rain, 'rain')
    expect(await rain.takes.trim(rain.file, 'rain', loop.file, false)).toMatchObject({
      ok: false,
    })
    const ctx = door(quiet.silence)
    const once = await made(ctx)
    writeFileSync(
      join(ctx.root, 'tts/effects.json'),
      JSON.stringify([{ id: 'door-creak', text: 'A door', seconds: 3, loops: true }]),
    )
    expect(await ctx.takes.trim(ctx.file, 'door-creak', once.file, false)).toMatchObject({
      ok: false,
    })
    expect((await ctx.settled('door-creak')).takes[0]!.trimmable).toBeUndefined()
  })

  it('chooses the trimmed sound: the game’s file and its length are the trimmed ones', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)
    expect(await ctx.takes.choose(ctx.file, 'door-creak', take.file)).toEqual({ ok: true })
    expect(wavSeconds(readWav(ctx.encoded.at(-1)!))).toBeCloseTo(1.27, 2)
    expect(manifest(ctx.root)['door-creak'].duration).toBeCloseTo(1.27, 1)
    expect((await ctx.settled('door-creak')).takes[0]).toMatchObject({ chosen: true })
  })

  it('rewrites the game’s file at once on the take in the game, keeping the lock’s time and words', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    await ctx.takes.choose(ctx.file, 'door-creak', take.file)
    const was = lock(ctx.root)['door-creak']
    expect(manifest(ctx.root)['door-creak'].duration).toBeCloseTo(1.4, 1)
    expect(await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)).toEqual({ ok: true })
    expect(wavSeconds(readWav(ctx.encoded.at(-1)!))).toBeCloseTo(1.27, 2)
    expect(manifest(ctx.root)['door-creak'].duration).toBeCloseTo(1.27, 1)
    expect(lock(ctx.root)['door-creak']).toEqual(was)
    const view = (await ctx.settled('door-creak')).takes[0]!
    expect(view).toMatchObject({ chosen: true })
    expect(view.trim).toBeDefined()
    // And back.
    expect(await ctx.takes.trim(ctx.file, 'door-creak', take.file, true)).toEqual({ ok: true })
    expect(wavSeconds(readWav(ctx.encoded.at(-1)!))).toBeCloseTo(1.4, 2)
    expect(manifest(ctx.root)['door-creak'].duration).toBeCloseTo(1.4, 1)
    expect(lock(ctx.root)['door-creak']).toEqual(was)
  })

  it('changes nothing when the game’s file cannot be rewritten', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    await ctx.takes.choose(ctx.file, 'door-creak', take.file)
    const manifestBefore = readFileSync(join(ctx.root, 'audio/effects/manifest.json'), 'utf8')
    // The manifest cannot be read, so the clip cannot be written again.
    writeFileSync(join(ctx.root, 'audio/effects/manifest.json'), '{ nope')
    const answer = await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)
    expect(answer).toEqual({
      ok: false,
      message: 'the sound effects manifest could not be read',
    })
    expect(board(ctx.root, 'door-creak').takes[0].trim).toBeUndefined()
    writeFileSync(join(ctx.root, 'audio/effects/manifest.json'), manifestBefore)
  })

  it('changes only the take when the game’s clip is missing, and Choose again writes it', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    await ctx.takes.choose(ctx.file, 'door-creak', take.file)
    rmSync(join(ctx.root, 'audio/effects/door-creak.mp3'))
    const encodedBefore = ctx.encoded.length
    expect(await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)).toEqual({ ok: true })
    expect(ctx.encoded.length).toBe(encodedBefore)
    expect(existsSync(join(ctx.root, 'audio/effects/door-creak.mp3'))).toBe(false)
    expect(board(ctx.root, 'door-creak').takes[0].trim).toBeDefined()
    await ctx.takes.choose(ctx.file, 'door-creak', take.file)
    expect(wavSeconds(readWav(ctx.encoded.at(-1)!))).toBeCloseTo(1.27, 2)
  })

  it('keeps a trim through Un-choose, and a trimmed take in the game can be untrimmed once the effect loops', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)
    await ctx.takes.choose(ctx.file, 'door-creak', take.file)
    await ctx.takes.unchoose(ctx.file, 'door-creak')
    expect((await ctx.settled('door-creak')).takes[0]!.trim).toBeDefined()
    await ctx.takes.choose(ctx.file, 'door-creak', take.file)
    writeFileSync(
      join(ctx.root, 'tts/effects.json'),
      JSON.stringify([
        { id: 'door-creak', text: 'A slow wooden door creaks open', seconds: 3, loops: true },
      ]),
    )
    const shown = (await ctx.settled('door-creak')).takes[0]!
    expect(shown.trim).toBeDefined()
    expect(await ctx.takes.trim(ctx.file, 'door-creak', take.file, true)).toEqual({ ok: true })
    expect(wavSeconds(readWav(ctx.encoded.at(-1)!))).toBeCloseTo(1.4, 2)
    // The lock still counts the take as made to play once.
    expect(lock(ctx.root)['door-creak'].inputs.loops).toBeUndefined()
  })

  it('goes with the take when it is dropped', async () => {
    const ctx = door(quiet.silence)
    const take = await made(ctx)
    await ctx.takes.trim(ctx.file, 'door-creak', take.file, false)
    await ctx.takes.drop(ctx.file, 'door-creak', take.file)
    expect(board(ctx.root, 'door-creak').takes).toEqual([])
  })
})
