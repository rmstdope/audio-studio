import { describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tooLongLine } from '../core/fades'
import { wavSeconds } from '../core/musicTake'
import { readWav, writeWav } from '../core/wav'
import { projectJson, tempRepo } from '../../test/helpers'
import { setTrackBrief } from './briefs'
import { createSerial } from './serial'
import type { MusicGenerator, MusicReady, MusicRequest } from './music'
import { FileNotWritten, type Encoder } from './audio'
import { loadProject } from './workspace'
import { boardQueue, createMusicTakes, musicTakeHash } from './musicTakes'
import { GPU, gpuInUse } from './gpu'
import { refreshDialog, refreshShared } from './refresh'
import { stopAll } from './stopWithStudio'
import type { MusicSpend } from '../core/spending'
import { createHash } from 'node:crypto'

const music = {
  paths: {
    loops: 'tts/{part}/music.json',
    stingers: 'tts/stingers.json',
    briefs: 'music/briefs.json',
    lock: 'music/music.lock.json',
    clips: 'audio/music',
    manifest: 'audio/music/manifest.json',
  },
}

/**
 * A generator that makes a tone as long as asked (at 1000 Hz), and fails for a brief saying "fail".
 * A `seedless` one answers without a seed, as a generator that takes none does.
 */
function fakeGenerator(
  ready: MusicReady = { ok: true },
  failOn: number[] = [],
  gate?: Promise<void>,
  missing: string[] = [],
  seedless = false,
) {
  const requests: MusicRequest[] = []
  const generator: MusicGenerator = {
    ready: () => ready,
    installed: (model) => !missing.includes(model),
    async generate(request) {
      requests.push(request)
      await gate
      if (failOn.includes(requests.length - 1) || request.brief.includes('fail'))
        throw new Error('The music generator: out of memory')
      const samples = new Int16Array(request.seconds * 1000)
      samples.forEach((_, i) => (samples[i] = Math.round(8000 * Math.sin(i / 20))))
      const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
      const wav = writeWav({ format, data: new Uint8Array(samples.buffer) })
      return seedless ? { wav } : { wav, seed: request.seed }
    },
    close() {},
  }
  return { generator, requests }
}

function setup(
  ready?: MusicReady,
  extra: Record<string, unknown> = {},
  failOn: number[] = [],
  gate?: Promise<void>,
  missing: string[] = [],
  seedless = false,
  encoder?: Encoder,
) {
  const root = tempRepo({
    'content-studio.json': projectJson({ music }),
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 30 }],
    'tts/stingers.json': [{ id: 'victory', title: 'Victory', brief: 'fanfare', seconds: 6 }],
    ...extra,
  })
  const file = join(root, 'content-studio.json')
  const { generator, requests } = fakeGenerator(ready, failOn, gate, missing, seedless)
  let seed = 100
  /** What the encoder was given, and whether it should fail. */
  const spy = { wavs: [] as Uint8Array[], fail: false }
  const encode: Encoder = async (wav, out) => {
    if (spy.fail) throw new Error('The disk is full.')
    spy.wavs.push(wav)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, 'mp3')
  }
  const takes = createMusicTakes({
    generator,
    encode: encoder ?? encode,
    queue: createSerial(),
    now: () => 0,
    newSeed: () => seed++,
  })
  /** The view once nothing is waiting or being made. */
  async function settled(id: string) {
    for (let i = 0; i < 200; i++) {
      const view = await takes.view(file, id)
      if (!view || !('ok' in view) || !view.ok) return view
      if (!view.making.length) return view
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('takes never finished')
  }
  return { root, file, takes, requests, settled, spy }
}

describe('makeAll, stopAll and modelState', () => {
  const two = {
    'tts/act1/music.json': [
      { id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 30 },
      { id: 'cellar', title: 'Cellar', brief: 'drips', seconds: 20 },
    ],
  }

  it('makes four takes for every track with no chosen take, and none for a chosen one', async () => {
    const { file, takes, requests, settled } = setup(undefined, two)
    await takes.make(file, 'hall', { count: 1 })
    const first = await settled('hall')
    if (!first || !('ok' in first) || !first.ok) throw new Error('expected a view')
    expect(await takes.choose(file, 'hall', first.takes[0]!.file)).toMatchObject({ ok: true })
    requests.length = 0
    expect(await takes.makeAll(file, 'act1')).toEqual({ ok: true, tracks: 1, takes: 4 })
    const cellar = await settled('cellar')
    if (!cellar || !('ok' in cellar) || !cellar.ok) throw new Error('expected a view')
    expect(cellar.takes).toHaveLength(4)
    expect(requests).toHaveLength(4)
    const hall = await settled('hall')
    expect(hall).toMatchObject({ takes: [{ n: 1, chosen: true }] })
  })

  it('leaves out a track already making takes', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes } = setup(undefined, two, [], gate)
    await takes.make(file, 'hall', { count: 1 })
    expect(await takes.makeAll(file, 'act1')).toEqual({ ok: true, tracks: 1, takes: 4 })
    expect(await takes.making(file)).toMatchObject({
      hall: { takes: 1 },
      cellar: { takes: 4 },
    })
    release()
  })

  it('leaves out a track the project’s model cannot make at its length', async () => {
    const root = tempRepo({
      'content-studio.json': projectJson({ music: { ...music, model: 'short' } }),
      'tts/act1/music.json': [
        { id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 20 },
        { id: 'cellar', title: 'Cellar', brief: 'drips', seconds: 120 },
      ],
    })
    const file = join(root, 'content-studio.json')
    const { generator } = fakeGenerator()
    const takes = createMusicTakes({ generator, queue: createSerial(), newSeed: () => 1 })
    expect(await takes.makeAll(file, 'act1')).toEqual({ ok: true, tracks: 1, takes: 4 })
  })

  it('starts nothing when music cannot be made yet', async () => {
    const { file, takes } = setup({ ok: false, message: 'no GPU', fix: 'x' }, two)
    expect(await takes.makeAll(file, 'act1')).toEqual({ ok: false, message: 'no GPU' })
    expect(await takes.making(file)).toEqual({})
  })

  it('knows no list that is not there', async () => {
    const { file, takes } = setup(undefined, two)
    expect(await takes.makeAll(file, 'nobody')).toBeNull()
    expect(await takes.stopAll(file, 'nobody')).toBeNull()
  })

  it('stops every take of the list that waits or is being made, and keeps the rest', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes } = setup(undefined, two, [], gate)
    await takes.makeAll(file, 'act1')
    expect(await takes.stopAll(file, 'act1')).toEqual({
      ok: true,
      stopped: 8,
      byTrack: { hall: 4, cellar: 4 },
    })
    expect(await takes.making(file)).toEqual({})
    release()
  })

  it('stops what it queued, and says nothing was made, when a track cannot be started', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    // The second track's board cannot be read, so its takes cannot be started.
    const { file, takes } = setup(
      undefined,
      { ...two, '.content-studio/music/cellar.json': '{ not json' },
      [],
      gate,
    )
    const answer = await takes.makeAll(file, 'act1')
    expect(answer).toMatchObject({ ok: false })
    expect(await takes.making(file)).toEqual({})
    release()
  })

  it('says which model the project makes music with and whether it can', async () => {
    const { file, takes } = setup()
    expect(await takes.modelState(file)).toEqual({
      ok: true,
      model: 'balanced',
      ready: true,
      message: null,
    })
    const unready = setup({ ok: false, message: 'no GPU', fix: 'x' })
    expect(await unready.takes.modelState(unready.file)).toMatchObject({
      ready: false,
      message: 'no GPU',
    })
    const missing = setup(undefined, {}, [], undefined, ['balanced'])
    expect(await missing.takes.modelState(missing.file)).toMatchObject({ ready: false })
  })
})

describe('the summary of a press on a list is kept by the studio', () => {
  const two = {
    'tts/act1/music.json': [
      { id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 30 },
      { id: 'cellar', title: 'Cellar', brief: 'drips fail', seconds: 20 },
    ],
  }

  it('is there for a caller who never saw the press, says it runs, and is per list', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes, settled } = setup(undefined, two, [], gate)
    expect(await takes.batch(file, 'act1')).toBeNull()
    await takes.makeAll(file, 'act1')
    expect(await takes.batch(file, 'act1')).toEqual({
      total: 8,
      tracks: ['hall', 'cellar'],
      failedBefore: { hall: 0, cellar: 0 },
      stopped: 0,
      running: true,
    })
    expect(await takes.batch(file, 'stingers')).toBeNull()
    release()
    await settled('hall')
    await settled('cellar')
    expect(await takes.batch(file, 'act1')).toMatchObject({ total: 8, running: false })
    expect(await takes.batch(file, 'nobody')).toBeNull()
  })

  it('counts the takes Stop all stopped on the press’s own tracks', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes } = setup(undefined, two, [], gate)
    await takes.makeAll(file, 'act1')
    await takes.stopAll(file, 'act1')
    expect(await takes.batch(file, 'act1')).toMatchObject({ stopped: 8, running: false })
    release()
  })

  it('counts the takes stopped on one of its tracks’ own page, so they are not counted as made', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes } = setup(undefined, two, [], gate)
    await takes.makeAll(file, 'act1')
    await takes.stop(file, 'hall')
    expect(await takes.batch(file, 'act1')).toMatchObject({ stopped: 4, running: true })
    await takes.stopAll(file, 'act1')
    expect(await takes.batch(file, 'act1')).toMatchObject({ stopped: 8, running: false })
    release()
  })

  it('does not count takes started by hand on its tracks among the ones it stopped', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes } = setup(undefined, two, [], gate)
    await takes.makeAll(file, 'act1')
    await takes.make(file, 'hall', { count: 1 })
    expect(await takes.stop(file, 'hall')).toEqual({ ok: true, stopped: 5 })
    expect(await takes.batch(file, 'act1')).toMatchObject({ stopped: 4 })
    await takes.make(file, 'cellar', { count: 2 })
    await takes.stopAll(file, 'act1')
    expect(await takes.batch(file, 'act1')).toMatchObject({ stopped: 8, running: false })
    release()
  })

  it('remembers how many takes had failed before the press', async () => {
    const { file, takes, settled } = setup(undefined, two)
    await takes.make(file, 'cellar', { count: 1 })
    await settled('cellar')
    await takes.makeAll(file, 'act1')
    expect(await takes.batch(file, 'act1')).toMatchObject({
      failedBefore: { hall: 0, cellar: 1 },
    })
  })

  it('is kept by a press that starts nothing, and seen by a studio object that never saw it', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes } = setup(undefined, two, [], gate)
    await takes.makeAll(file, 'act1')
    const first = await takes.batch(file, 'act1')
    // Every track is already making takes: the second press starts none and replaces nothing.
    expect(await takes.makeAll(file, 'act1')).toMatchObject({ takes: 0 })
    expect(await takes.batch(file, 'act1')).toEqual(first)
    const other = createMusicTakes({ generator: fakeGenerator().generator, queue: createSerial() })
    expect(await other.batch(file, 'act1')).toEqual(first)
    release()
  })

  it('is forgotten by closeBatch, and by takes started by hand once it has ended', async () => {
    const { file, takes, settled } = setup(undefined, two)
    await takes.makeAll(file, 'act1')
    await settled('hall')
    await settled('cellar')
    expect(await takes.closeBatch(file, 'act1')).toEqual({ ok: true })
    expect(await takes.batch(file, 'act1')).toBeNull()
    await takes.makeAll(file, 'act1')
    await settled('hall')
    await settled('cellar')
    await takes.make(file, 'hall', { count: 1 })
    expect(await takes.batch(file, 'act1')).toBeNull()
  })

  it('goes on while takes are started by hand during the press, and a new press replaces it', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes, settled } = setup(undefined, two, [], gate)
    await takes.makeAll(file, 'act1')
    await takes.make(file, 'hall', { count: 1 })
    expect(await takes.batch(file, 'act1')).toMatchObject({ total: 8, running: true })
    release()
    await settled('hall')
    await settled('cellar')
    await takes.closeBatch(file, 'act1')
    await takes.makeAll(file, 'act1')
    await settled('hall')
    await settled('cellar')
    expect(await takes.batch(file, 'act1')).toMatchObject({
      total: 8,
      failedBefore: { hall: 0, cellar: 4 },
      running: false,
    })
  })
})

describe('createMusicTakes', () => {
  it('makes two takes of a loop, shaped to its length, and lists them with their seeds', async () => {
    const { file, takes, requests, settled } = setup()
    expect(await takes.make(file, 'hall', { count: 2 })).toEqual({ ok: true })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.kind).toBe('loop')
    expect(view.takes.map((t) => [t.n, t.seconds, t.seed])).toEqual([
      [1, 30, 100],
      [2, 30, 101],
    ])
    expect(view.takes[0]!.peaks.length).toBeGreaterThan(10)
    // Generated 20 s longer than it plays.
    expect(requests.map((r) => r.seconds)).toEqual([50, 50])
    expect(requests[0]).toMatchObject({ brief: 'warm lute', kind: 'loop', bpm: null, key: null })
  })

  it('shows as music on the GPU while a take is made', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes, settled } = setup(undefined, {}, [], gate)
    await takes.make(file, 'hall', { count: 1 })
    for (let i = 0; i < 200 && !gpuInUse(); i++) await new Promise((r) => setTimeout(r, 5))
    expect(gpuInUse()).toBe('music')
    release()
    await settled('hall')
    expect(gpuInUse()).toBeNull()
  })

  it('shows a take being made and the next waiting, in turn', async () => {
    // The generator waits for the test, so what is seen does not depend on how fast the queue runs.
    let release = () => {}
    const { file, takes, settled } = setup(
      undefined,
      {},
      [],
      new Promise<void>((resolve) => (release = resolve)),
    )
    await takes.make(file, 'hall', { count: 2 })
    const view = await takes.view(file, 'hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.making.map((m) => [m.n, m.state])).toEqual([
      [1, 'making'],
      [2, 'waiting'],
    ])
    release()
    await settled('hall')
  })

  it('cuts a stinger at its own length', async () => {
    const { file, takes, requests, settled } = setup()
    await takes.make(file, 'victory', { count: 1 })
    const view = await settled('victory')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.kind).toBe('stinger')
    expect(view.takes[0]!.seconds).toBe(6)
    expect(requests[0]!.seconds).toBe(10)
  })

  it('continues the numbering, and serves each take as a WAV of its length', async () => {
    const { file, root, takes, settled } = setup()
    await takes.make(file, 'hall', { count: 1 })
    await settled('hall')
    await takes.make(file, 'hall', { count: 1 })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.takes.map((t) => t.n)).toEqual([1, 2])
    const path = await takes.takeFile(file, 'hall', view.takes[1]!.file)
    expect(path).toStartWith(join(root, '.content-studio/music-takes/hall/'))
    expect(wavSeconds(readWav(new Uint8Array(readFileSync(path!))))).toBe(30)
  })

  it('keeps the takes of an earlier brief on the board, marked, and numbers on from them', async () => {
    const { file, takes, requests, settled } = setup()
    await takes.make(file, 'hall', { count: 1 })
    await settled('hall')
    await setTrackBrief(file, 'hall', { brief: 'a drum' })
    const changed = await settled('hall')
    if (!changed || !('ok' in changed) || !changed.ok) throw new Error('expected a view')
    expect(changed.takes.map((t) => [t.n, t.earlier])).toEqual([[1, true]])
    await takes.make(file, 'hall', { count: 1 })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.takes.map((t) => [t.n, t.earlier])).toEqual([
      [1, true],
      [2, false],
    ])
    expect(requests[1]!.brief).toBe('a drum')
  })

  it('marks a take made from a brief that changed while it was made', async () => {
    const { file, takes, settled } = setup()
    await takes.make(file, 'hall', { count: 1 })
    await setTrackBrief(file, 'hall', { brief: 'a drum' })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.takes.map((t) => [t.n, t.earlier])).toEqual([[1, true]])
  })

  it('keeps its takes on a saved board that a new instance reads, and never reuses a number', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'hall', { count: 2 })
    await settled('hall')
    const board = JSON.parse(readFileSync(join(root, '.content-studio/music/hall.json'), 'utf8'))
    expect(board.next).toBe(3)
    expect(board.takes.map((t: { n: number }) => t.n)).toEqual([1, 2])
    expect(
      readdirSync(join(root, '.content-studio/music-takes/hall')).some((f) => f.endsWith('.json')),
    ).toBe(false)
    const again = createMusicTakes({
      generator: fakeGenerator().generator,
      queue: createSerial(),
      newSeed: () => 7,
    })
    const view = await again.view(file, 'hall')
    expect(view).toMatchObject({ takes: [{ n: 1 }, { n: 2 }] })
    const dropped = (view as { takes: { file: string }[] }).takes[1]!.file
    expect(await again.drop(file, 'hall', dropped)).toEqual({ ok: true })
    await again.make(file, 'hall', { count: 1 })
    for (let i = 0; i < 200; i++) {
      const v = await again.view(file, 'hall')
      if (v && 'making' in v && !v.making.length) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const last = await again.view(file, 'hall')
    expect(last).toMatchObject({ takes: [{ n: 1 }, { n: 3 }] })
  })

  it('reports a broken board file instead of overwriting it', async () => {
    const { file, takes } = setup(undefined, { '.content-studio/music/hall.json': '{ nope' })
    const view = await takes.view(file, 'hall')
    expect(view).toMatchObject({ ok: false })
    expect(JSON.stringify(view)).toContain('.content-studio/music/hall.json')
    expect(await takes.make(file, 'hall', { count: 1 })).toMatchObject({ ok: false })
  })

  it('drops a take: its entry and its file go, the others stay', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'hall', { count: 2 })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    const [first, second] = view.takes
    expect(await takes.drop(file, 'hall', first!.file)).toEqual({ ok: true })
    expect(await takes.takeFile(file, 'hall', first!.file)).toBeNull()
    expect(existsSync(join(root, '.content-studio/music-takes/hall', first!.file))).toBe(false)
    expect(await takes.view(file, 'hall')).toMatchObject({ takes: [{ n: second!.n }] })
  })

  it('refuses to drop what is not on the board, and an unknown track, writing nothing', async () => {
    const { root, file, takes } = setup()
    expect(await takes.drop(file, 'hall', 'aaaaaaaaaaaaaaaa.1.wav')).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
    expect(await takes.drop(file, 'hall', '../../content-studio.json')).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
    expect(await takes.drop(file, 'nope', 'aaaaaaaaaaaaaaaa.1.wav')).toBeNull()
    expect(existsSync(join(root, '.content-studio/music/hall.json'))).toBe(false)
  })

  it('stops every take: the one being made ends and is discarded, the waiting ones never start', async () => {
    const { root, file, takes: first, settled } = setup()
    await first.make(file, 'hall', { count: 1 })
    await settled('hall')
    // A generator that makes nothing until released, and gives up when the take is stopped.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const inner = fakeGenerator()
    const signals: (AbortSignal | undefined)[] = []
    const slow: MusicGenerator = {
      ...inner.generator,
      generate: async (request, signal) => {
        signals.push(signal)
        await Promise.race([
          gate,
          new Promise((_, reject) =>
            signal?.addEventListener('abort', () =>
              reject(new Error('The music generator stopped')),
            ),
          ),
        ])
        return inner.generator.generate(request)
      },
    }
    const queue = createSerial()
    const takes = createMusicTakes({ generator: slow, queue, newSeed: () => 1 })
    await takes.make(file, 'hall', { count: 3 })
    for (let i = 0; i < 200 && !signals.length; i++) await new Promise((r) => setTimeout(r, 5))
    expect(await takes.stop(file, 'hall')).toEqual({ ok: true, stopped: 3 })
    expect(signals[0]?.aborted).toBe(true)
    expect(await takes.view(file, 'hall')).toMatchObject({
      takes: [{ n: 1 }],
      making: [],
      failed: [],
    })
    release()
    await queue.run(GPU, async () => {})
    // Nothing more is made: no board entry, no file, no further request; the earlier take stays.
    expect(await takes.view(file, 'hall')).toMatchObject({
      takes: [{ n: 1 }],
      making: [],
      failed: [],
    })
    expect(readdirSync(join(root, '.content-studio/music-takes/hall'))).toHaveLength(1)
    expect(signals).toHaveLength(1)
    expect(await takes.making(file)).toEqual({})
    expect(await takes.stop(file, 'hall')).toEqual({ ok: true, stopped: 0 })
    expect(await takes.stop(file, 'nope')).toBeNull()
  })

  it('discards a take stopped after it was made but before it was saved', async () => {
    const { root, file } = setup()
    const queue = createSerial()
    const takes = createMusicTakes({
      generator: fakeGenerator().generator,
      queue,
      newSeed: () => 1,
    })
    await takes.make(file, 'hall', { count: 1 })
    // The track's board turn is held, so the finished take waits there to be saved.
    let release: () => void = () => {}
    const held = boardQueue().run(`${file}\0hall`, () => new Promise<void>((r) => (release = r)))
    const folder = join(root, '.content-studio/music-takes/hall')
    for (let i = 0; i < 200 && !(existsSync(folder) && readdirSync(folder).length); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(await takes.stop(file, 'hall')).toEqual({ ok: true, stopped: 1 })
    release()
    await held
    await queue.run(GPU, async () => {})
    expect(await takes.view(file, 'hall')).toMatchObject({ takes: [], making: [], failed: [] })
    expect(readdirSync(folder)).toEqual([])
  })

  it('sums what is being made across the project: takes and about how long', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const inner = fakeGenerator().generator
    const slow: MusicGenerator = {
      ...inner,
      generate: async (request) => {
        await gate
        return inner.generate(request)
      },
    }
    const { file } = setup()
    let clock = 0
    const takes = createMusicTakes({
      generator: slow,
      queue: createSerial(),
      now: () => clock,
      newSeed: () => 1,
    })
    await takes.make(file, 'hall', { count: 2 })
    await takes.make(file, 'victory', { count: 1 })
    clock = 60_000
    expect(await takes.making(file)).toEqual({
      hall: { takes: 2, left: 120 + 180, failed: 0 },
      victory: { takes: 1, left: 180, failed: 0 },
    })
    release()
    for (let i = 0; i < 200 && Object.keys(await takes.making(file)).length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(await takes.making(file)).toEqual({})
  })

  it('counts the takes that failed in the making summary, with none left to make', async () => {
    const { file, takes, settled } = setup(undefined, {}, [0, 1])
    await takes.make(file, 'hall', { count: 2 })
    await settled('hall')
    expect(await takes.making(file)).toEqual({ hall: { takes: 0, left: 0, failed: 2 } })
  })

  it('keeps the other takes when one fails, saying why', async () => {
    const { file, takes, settled } = setup(undefined, {}, [1])
    await takes.make(file, 'hall', { count: 2 })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.takes.map((t) => t.n)).toEqual([1])
    expect(view.failed).toEqual([
      {
        n: 2,
        message: 'The music generator stopped: out of memory.',
        model: 'Balanced · XL turbo · 4B',
        modelId: 'balanced',
      },
    ])
  })

  it('says a crashed worker stopped, in the same words', async () => {
    const crashing: MusicGenerator = {
      ready: () => ({ ok: true }),
      installed: () => true,
      generate: () => Promise.reject(new Error('The music generator stopped (exit code 3): boom')),
      close() {},
    }
    const { file } = setup()
    const takes = createMusicTakes({ generator: crashing, queue: createSerial(), newSeed: () => 1 })
    await takes.make(file, 'hall', { count: 1 })
    let view = await takes.view(file, 'hall')
    for (let i = 0; i < 100 && view && 'making' in view && view.making.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      view = await takes.view(file, 'hall')
    }
    expect(view).toMatchObject({
      failed: [{ n: 1, message: 'The music generator stopped (exit code 3): boom.' }],
    })
  })

  it('remembers what is being made across a reload of the module that made it', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const inner = fakeGenerator().generator
    const slow: MusicGenerator = {
      ...inner,
      generate: async (request) => {
        await gate
        return inner.generate(request)
      },
    }
    const { file } = setup()
    const takes = createMusicTakes({ generator: slow, queue: createSerial(), newSeed: () => 1 })
    await takes.make(file, 'hall', { count: 1 })
    const again = createMusicTakes({ generator: inner, queue: createSerial(), newSeed: () => 1 })
    expect(await again.view(file, 'hall')).toMatchObject({ making: [{ n: 1 }] })
    release()
  })

  it('retries the number that failed, and the take then exists', async () => {
    const { file, takes, requests, settled } = setup(undefined, {}, [0])
    await takes.make(file, 'hall', { count: 1 })
    const first = await settled('hall')
    if (!first || !('ok' in first) || !first.ok) throw new Error('expected a view')
    expect(first.failed.map((f) => f.n)).toEqual([1])
    expect(await takes.make(file, 'hall', { retry: 1 })).toEqual({ ok: true })
    const again = await settled('hall')
    if (!again || !('ok' in again) || !again.ok) throw new Error('expected a view')
    expect(again.failed).toEqual([])
    expect(again.takes.map((t) => t.n)).toEqual([1])
    expect(requests).toHaveLength(2)
  })

  it('keeps every take hash as it was before models were chosen', () => {
    const inputs = { brief: 'warm lute', kind: 'loop', seconds: 30, bpm: null, key: null } as const
    const before = createHash('sha256')
      .update(JSON.stringify(['acestep-v15-xl-turbo+lm-4B', 'warm lute', 'loop', 30, null, null]))
      .digest('hex')
      .slice(0, 16)
    expect(musicTakeHash(inputs)).toBe(before)
  })

  it('makes takes with the model asked for, and records it on each take', async () => {
    const { file, takes, requests, settled } = setup()
    expect(await takes.make(file, 'hall', { count: 1, model: 'quick' })).toEqual({ ok: true })
    await takes.make(file, 'hall', { count: 1 })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(requests.map((r) => r.model)).toEqual(['quick', 'balanced'])
    expect(view.takes.map((t) => t.model)).toEqual([
      'Quick · XL turbo · 1.7B',
      'Balanced · XL turbo · 4B',
    ])
    // A take of another model is not "earlier": only a changed brief, length, tempo or key is.
    expect(view.takes.map((t) => t.earlier)).toEqual([false, false])
  })

  it('makes a stinger with a Stable Audio model, and the take names it', async () => {
    const { file, takes, requests, settled } = setup()
    expect(await takes.make(file, 'victory', { count: 1, model: 'shortest' })).toEqual({ ok: true })
    const view = await settled('victory')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(requests.map((r) => r.model)).toEqual(['shortest'])
    expect(view.takes.map((t) => t.model)).toEqual(['Shortest · Stable Audio Open Small'])
  })

  it('refuses a model that cannot make the track’s length, before anything is queued', async () => {
    const { file, takes, requests } = setup()
    expect(await takes.make(file, 'hall', { count: 2, model: 'short' })).toEqual({
      ok: false,
      message:
        'Short makes loops up to 27 s, and this one is 0:30. Pick another model for these takes.',
    })
    expect(await takes.make(file, 'hall', { count: 1, model: 'shortest' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('Shortest makes no loops'),
    })
    expect(requests).toEqual([])
    const view = await takes.view(file, 'hall')
    expect(view).toMatchObject({ making: [], takes: [] })
  })

  it('refuses the project’s own model too when it cannot make the track', async () => {
    const { file, takes } = setup(undefined, {
      'content-studio.json': projectJson({ music: { ...music, model: 'short' } }),
    })
    expect(await takes.make(file, 'hall', { count: 1 })).toMatchObject({ ok: false })
    expect(await takes.make(file, 'victory', { count: 1 })).toEqual({ ok: true })
  })

  it('uses the project’s model when none is asked for', async () => {
    const { file, takes, requests, settled } = setup(undefined, {
      'content-studio.json': projectJson({ music: { ...music, model: 'quickest' } }),
    })
    await takes.make(file, 'hall', { count: 1 })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(requests[0]!.model).toBe('quickest')
    expect(view.defaultModel).toBe('quickest')
  })

  it('shows a take made before models were chosen as Balanced', async () => {
    const { root, file, takes, settled } = setup()
    await takes.make(file, 'hall', { count: 1 })
    await settled('hall')
    const board = join(root, '.content-studio/music/hall.json')
    const saved = JSON.parse(readFileSync(board, 'utf8'))
    delete saved.takes[0].model
    writeFileSync(board, JSON.stringify(saved))
    const view = await takes.view(file, 'hall')
    expect(view).toMatchObject({ takes: [{ model: 'Balanced · XL turbo · 4B' }] })
  })

  describe('whether music can be made, as the page says', () => {
    /** Takes for a project whose model is Eleven Music, every model installed as `installed` says. */
    function elevenProject(installed: (model: string) => boolean, localReady: MusicReady) {
      const root = tempRepo({
        'content-studio.json': projectJson({ music: { ...music, model: 'eleven' } }),
        'tts/act1/music.json': [{ id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 30 }],
        'tts/stingers.json': [],
      })
      const generator: MusicGenerator = {
        ...fakeGenerator().generator,
        installed,
        ready: (model) =>
          model === 'eleven'
            ? installed('eleven')
              ? { ok: true }
              : { ok: false, message: 'There is no ElevenLabs key.', fix: '' }
            : localReady,
      }
      const takes = createMusicTakes({ generator, queue: createSerial(), newSeed: () => 1 })
      return { file: join(root, 'content-studio.json'), takes }
    }
    const noUv: MusicReady = { ok: false, message: 'uv is not on the PATH.', fix: '' }

    it('is the project’s model’s answer when it can be used, not the first local one’s', async () => {
      const { file, takes } = elevenProject(() => true, noUv)
      expect(await takes.view(file, 'hall')).toMatchObject({ generator: { ok: true } })
    })

    it('says the key is missing when nothing can be used and the project’s model is Eleven Music', async () => {
      const { file, takes } = elevenProject(() => false, noUv)
      expect(await takes.view(file, 'hall')).toMatchObject({
        generator: { ok: false, message: 'There is no ElevenLabs key.' },
      })
    })
  })

  it('refuses Eleven Music without a key, saying so', async () => {
    const { file, takes } = setup(undefined, {}, [], undefined, ['eleven'])
    expect(await takes.make(file, 'hall', { count: 1, model: 'eleven' })).toEqual({
      ok: false,
      message: 'Eleven Music needs an ElevenLabs key.',
    })
  })

  it('makes an Eleven Music take while the GPU is busy, and local takes wait for it', async () => {
    const { file } = setup()
    const queue = createSerial()
    const takes = createMusicTakes({
      generator: fakeGenerator().generator,
      queue,
      newSeed: () => 1,
    })
    let release: () => void = () => {}
    const busy = queue.run(GPU, () => new Promise<void>((resolve) => (release = resolve)))
    await takes.make(file, 'hall', { count: 1, model: 'eleven' })
    await takes.make(file, 'hall', { count: 1, model: 'balanced' })
    let view = await takes.view(file, 'hall')
    for (let i = 0; i < 200 && view && 'ok' in view && view.ok && !view.takes.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      view = await takes.view(file, 'hall')
    }
    expect(view).toMatchObject({
      takes: [{ n: 1, model: 'Eleven Music · ElevenLabs, in the cloud' }],
      making: [{ n: 2, state: 'waiting' }],
    })
    release()
    await busy
  })

  it('says what a paid take cost once it is made, and nothing of a free one', async () => {
    const { file } = setup()
    const spent: { projectFile: string; take: MusicSpend }[] = []
    const takes = createMusicTakes({
      generator: fakeGenerator().generator,
      queue: createSerial(),
      newSeed: () => 1,
      now: () => Date.parse('2026-10-27T12:00:00Z'),
      spent: (projectFile, take) => void spent.push({ projectFile, take }),
    })
    await takes.make(file, 'hall', { count: 1, model: 'eleven' })
    await takes.make(file, 'hall', { count: 1, model: 'balanced' })
    for (let i = 0; i < 200 && spent.length === 0; i++) await Bun.sleep(5)
    await Bun.sleep(20)
    // A 30-second loop is made 50 seconds long, at $0.15 a minute.
    expect(spent).toEqual([
      {
        projectFile: file,
        take: {
          id: expect.any(String),
          at: '2026-10-27T12:00:00.000Z',
          part: 'act1',
          track: 'hall',
          title: 'Hall',
          model: 'eleven',
          seconds: 50,
          cost: 0.125,
          outcome: 'done',
        },
      },
    ])
  })

  it('says a paid take cost its price when ElevenLabs made it but the studio could not keep it', async () => {
    const { file } = setup()
    const spent: MusicSpend[] = []
    const takes = createMusicTakes({
      generator: {
        ...fakeGenerator().generator,
        // Made and billed, but not audio the studio can read.
        generate: async () => ({ wav: new Uint8Array([1, 2, 3]) }),
      },
      queue: createSerial(),
      newSeed: () => 1,
      spent: (_file, take) => void spent.push(take),
    })
    await takes.make(file, 'victory', { count: 1, model: 'eleven' })
    for (let i = 0; i < 200 && spent.length === 0; i++) await Bun.sleep(5)
    expect(spent).toMatchObject([{ track: 'victory', cost: 0.025, outcome: 'done' }])
    const view = await takes.view(file, 'victory')
    expect(view).toMatchObject({ failed: [{ n: 1 }] })
  })

  it('says a paid take stopped while it was made may have cost its price', async () => {
    const { file } = setup()
    const spent: MusicSpend[] = []
    const takes = createMusicTakes({
      generator: {
        ...fakeGenerator().generator,
        // As ElevenLabs' client does: a stop ends the request, which then fails.
        generate: (_request, signal) =>
          new Promise((_resolve, reject) =>
            signal?.addEventListener('abort', () => reject(new Error('stopped'))),
          ),
      },
      queue: createSerial(),
      newSeed: () => 1,
      spent: (_file, take) => void spent.push(take),
    })
    await takes.make(file, 'victory', { count: 1, model: 'eleven' })
    for (let i = 0; i < 200; i++) {
      const view = await takes.view(file, 'victory')
      if (view && 'ok' in view && view.ok && view.making[0]?.state === 'making') break
      await Bun.sleep(5)
    }
    await takes.stop(file, 'victory')
    await Bun.sleep(20)
    expect(spent).toMatchObject([
      { part: 'stingers', track: 'victory', seconds: 10, cost: 0.025, outcome: 'stopped' },
    ])
  })

  it('refuses a model that is not on this computer, and says which models are', async () => {
    const { file, takes } = setup(undefined, {}, [], undefined, ['careful'])
    expect(await takes.make(file, 'hall', { count: 1, model: 'careful' })).toEqual({
      ok: false,
      message: 'Careful is not on this computer.',
    })
    const view = await takes.view(file, 'hall')
    expect(view).toMatchObject({
      ok: true,
      generator: { ok: true },
      defaultModel: 'balanced',
      models: [
        { id: 'balanced', installed: true },
        { id: 'quick', installed: true },
        { id: 'quickest', installed: true },
        { id: 'careful', installed: false },
        { id: 'short', installed: true },
        { id: 'shortest', installed: true },
        { id: 'eleven', installed: true },
      ],
    })
  })

  it('says the generator is not installed only when no model is here', async () => {
    const all = ['balanced', 'quick', 'quickest', 'careful']
    const { file, takes } = setup(
      { ok: false, message: 'none here', fix: 'download' },
      {},
      [],
      undefined,
      all,
    )
    expect(await takes.view(file, 'hall')).toMatchObject({
      generator: { ok: false, message: 'none here' },
    })
  })

  it('remakes a failed take with the model it was asked with, and times each by its model', async () => {
    const { file, takes, requests, settled } = setup(undefined, {}, [0])
    await takes.make(file, 'hall', { count: 1, model: 'careful' })
    await settled('hall')
    const failed = await takes.view(file, 'hall')
    expect(failed).toMatchObject({
      failed: [{ n: 1, model: 'Careful · XL sft · 4B', modelId: 'careful' }],
    })
    await takes.make(file, 'hall', { retry: 1 })
    await settled('hall')
    expect(requests.map((r) => r.model)).toEqual(['careful', 'careful'])
  })

  it('counts the time left of each take by its own model', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes } = setup(undefined, {}, [], gate)
    await takes.make(file, 'hall', { count: 1, model: 'careful' })
    await takes.make(file, 'hall', { count: 1, model: 'quickest' })
    const view = await takes.view(file, 'hall')
    expect(view).toMatchObject({
      making: [
        { n: 1, model: 'Careful · XL sft · 4B', expected: 420, paid: false },
        { n: 2, model: 'Quickest · Turbo · 1.7B', expected: 60, paid: false },
      ],
    })
    expect(await takes.making(file)).toEqual({ hall: { takes: 2, left: 480, failed: 0 } })
    release()
  })

  it('marks a take made with a paid model as paid, being made or failed', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { file, takes } = setup(undefined, {}, [], gate)
    await takes.make(file, 'hall', { count: 1, model: 'eleven' })
    expect(await takes.view(file, 'hall')).toMatchObject({
      making: [{ n: 1, model: 'Eleven Music · ElevenLabs, in the cloud', paid: true }],
    })
    release()
  })

  it('refuses a retry of a take that did not fail', async () => {
    const { file, takes } = setup()
    expect(await takes.make(file, 'hall', { retry: 9 })).toEqual({
      ok: false,
      message: 'Take 9 did not fail, so it is not made again.',
    })
  })

  it('refuses to make takes when the generator is not ready, and says why', async () => {
    const { file, takes } = setup({
      ok: false,
      message: 'uv is not on the PATH.',
      fix: 'brew install uv',
    })
    expect(await takes.make(file, 'hall', { count: 2 })).toEqual({
      ok: false,
      message: 'uv is not on the PATH.',
    })
    const view = await takes.view(file, 'hall')
    expect(view).toMatchObject({
      ok: true,
      generator: { ok: false, message: 'uv is not on the PATH.', fix: 'brew install uv' },
    })
  })

  it('knows no track the game does not list, and no music in a project without any', async () => {
    const { file, takes } = setup()
    expect(await takes.view(file, 'nope')).toBeNull()
    expect(await takes.make(file, 'nope', { count: 2 })).toBeNull()
    expect(await takes.takeFile(file, 'nope', 'aaaaaaaaaaaaaaaa.1.wav')).toBeNull()
    const bare = tempRepo({ 'content-studio.json': projectJson() })
    expect(await takes.view(join(bare, 'content-studio.json'), 'hall')).toBeNull()
  })

  it('serves only a take’s own file name', async () => {
    const { file, takes, settled } = setup()
    await takes.make(file, 'hall', { count: 1 })
    await settled('hall')
    expect(await takes.takeFile(file, 'hall', '../../../content-studio.json')).toBeNull()
    expect(await takes.takeFile(file, 'hall', 'aaaaaaaaaaaaaaaa.1.wav')).toBeNull()
  })

  it('writes under .content-studio/music-takes and nowhere else', async () => {
    const { root, file, takes, settled } = setup()
    const before = readdirSync(root, { recursive: true }).map(String)
    await takes.make(file, 'hall', { count: 2 })
    await settled('hall')
    const added = readdirSync(root, { recursive: true })
      .map(String)
      .filter((f) => !before.includes(f))
      .filter((f) => !f.startsWith('.content-studio'))
    expect(added).toEqual([])
    expect(existsSync(join(root, '.content-studio/music-takes/hall'))).toBe(true)
  })
})

describe('choosing a take', () => {
  async function twoTakes(extra: Record<string, unknown> = {}) {
    const made = setup(undefined, extra)
    await made.takes.make(made.file, 'hall', { count: 2 })
    await made.settled('hall')
    return made
  }
  const lockOf = (root: string) =>
    JSON.parse(readFileSync(join(root, 'music/music.lock.json'), 'utf8'))

  it('keeps and chooses a take made without a seed, with none recorded', async () => {
    const { root, file, takes, settled } = setup(undefined, {}, [], undefined, [], true)
    await takes.make(file, 'hall', { count: 1 })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.takes).toHaveLength(1)
    expect(view.takes[0]).not.toHaveProperty('seed')
    const board = JSON.parse(readFileSync(join(root, '.content-studio/music/hall.json'), 'utf8'))
    expect(board.takes[0]).not.toHaveProperty('seed')
    expect(await takes.choose(file, 'hall', view.takes[0]!.file)).toEqual({ ok: true })
    expect(lockOf(root).hall).toMatchObject({ take: 1, list: 'act1' })
    expect(lockOf(root).hall).not.toHaveProperty('seed')
    const after = await takes.view(file, 'hall')
    if (!after || !('ok' in after) || !after.ok) throw new Error('expected a view')
    expect(after.takes.map((t) => t.chosen)).toEqual([true])
  })

  it('writes the take as the track’s music, and the view marks it chosen', async () => {
    const { root, file, takes, settled } = await twoTakes()
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.takes.map((t) => t.chosen)).toEqual([false, false])
    expect(await takes.choose(file, 'hall', view.takes[1]!.file)).toEqual({ ok: true })
    expect(readFileSync(join(root, 'audio/music/hall.mp3'), 'utf8')).toBe('mp3')
    expect(lockOf(root).hall).toMatchObject({ take: 2, seed: 101, list: 'act1' })
    const after = await takes.view(file, 'hall')
    if (!after || !('ok' in after) || !after.ok) throw new Error('expected a view')
    expect(after.takes.map((t) => t.chosen)).toEqual([false, true])
  })

  it('makes the track chosen in the project summary, and a stinger’s list is stingers', async () => {
    const { file, takes } = setup()
    await takes.make(file, 'victory', { count: 1 })
    for (let i = 0; i < 100; i++) {
      const v = await takes.view(file, 'victory')
      if (v && 'ok' in v && v.ok && !v.making.length) break
      await new Promise((r) => setTimeout(r, 5))
    }
    const view = await takes.view(file, 'victory')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(await takes.choose(file, 'victory', view.takes[0]!.file)).toEqual({ ok: true })
    const loaded = await loadProject(file)
    if (!loaded.ok) throw new Error('project')
    const stingers = loaded.summary.music!.lists.find((l) => l.kind === 'stingers')!
    expect(stingers.tracks[0]).toMatchObject({ id: 'victory', status: 'chosen' })
  })

  it('chooses another take over the first; the first stays on the board', async () => {
    const { root, file, takes, settled } = await twoTakes()
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    await takes.choose(file, 'hall', view.takes[0]!.file)
    await takes.choose(file, 'hall', view.takes[1]!.file)
    expect(lockOf(root).hall.take).toBe(2)
    const after = await takes.view(file, 'hall')
    if (!after || !('ok' in after) || !after.ok) throw new Error('expected a view')
    expect(after.takes.map((t) => [t.n, t.chosen])).toEqual([
      [1, false],
      [2, true],
    ])
  })

  it('refuses a take that is not on the board, and an unknown track', async () => {
    const { file, takes } = await twoTakes()
    expect(await takes.choose(file, 'hall', '0123456789abcdef.9.wav')).toMatchObject({ ok: false })
    expect(await takes.choose(file, 'nope', '0123456789abcdef.1.wav')).toBeNull()
  })

  it('refuses to drop the chosen take, and drops another', async () => {
    const { root, file, takes, settled } = await twoTakes()
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    const [one, two] = view.takes
    await takes.choose(file, 'hall', one!.file)
    expect(await takes.drop(file, 'hall', one!.file)).toMatchObject({ ok: false })
    expect(existsSync(join(root, '.content-studio/music-takes/hall', one!.file))).toBe(true)
    expect(await takes.drop(file, 'hall', two!.file)).toEqual({ ok: true })
  })

  it('takes the choice back: the files go, the take stays on the board to be chosen or dropped', async () => {
    const { root, file, takes, settled } = await twoTakes()
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    const [one, two] = view.takes
    await takes.choose(file, 'hall', one!.file)
    expect(await takes.unchoose(file, 'hall')).toEqual({ ok: true })
    expect(existsSync(join(root, 'audio/music/hall.mp3'))).toBe(false)
    expect(lockOf(root).hall).toBeUndefined()
    const after = await takes.view(file, 'hall')
    if (!after || !('ok' in after) || !after.ok) throw new Error('expected a view')
    expect(after.takes.map((t) => [t.n, t.chosen])).toEqual([
      [1, false],
      [2, false],
    ])
    expect(await takes.drop(file, 'hall', one!.file)).toEqual({ ok: true })
    expect(await takes.choose(file, 'hall', two!.file)).toEqual({ ok: true })
  })

  it('refuses to un-choose a track with no chosen take, and an unknown track', async () => {
    const { file, takes } = await twoTakes()
    expect(await takes.unchoose(file, 'hall')).toMatchObject({ ok: false })
    expect(await takes.unchoose(file, 'nope')).toBeNull()
  })

  it('leaves the track changed when a take from an earlier brief is chosen', async () => {
    const { root, file, takes, settled } = await twoTakes()
    await setTrackBrief(file, 'hall', { brief: 'a new brief' })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    expect(view.takes[0]!.earlier).toBe(true)
    await takes.choose(file, 'hall', view.takes[0]!.file)
    const loaded = await loadProject(file)
    if (!loaded.ok) throw new Error('project')
    const row = loaded.summary.music!.lists[0]!.tracks[0]!
    expect(row).toMatchObject({ status: 'changed', changed: ['brief'] })
    expect(lockOf(root).hall.inputs.brief).toBe('warm lute')
  })

  it('never lets a drop of the take being chosen slip between the choice and the board', async () => {
    const { root, file, takes, settled } = await twoTakes()
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    const name = view.takes[0]!.file
    const [chosen, dropped] = await Promise.all([
      takes.choose(file, 'hall', name),
      takes.drop(file, 'hall', name),
    ])
    const after = await takes.view(file, 'hall')
    if (!after || !('ok' in after) || !after.ok) throw new Error('expected a view')
    const lock = existsSync(join(root, 'music/music.lock.json')) ? lockOf(root).hall : undefined
    // Either the take was chosen and stays, or it was dropped and nothing names it.
    if (lock) expect(after.takes.some((t) => t.chosen)).toBe(true)
    else expect(after.takes.some((t) => t.n === 1)).toBe(false)
    const succeeded = (answer: unknown) =>
      Boolean(answer && typeof answer === 'object' && 'ok' in answer && answer.ok === true)
    // Exactly one of the two wins.
    expect([succeeded(chosen), succeeded(dropped)].filter(Boolean)).toHaveLength(1)
  })

  it('refuses to drop anything while the lock cannot be read', async () => {
    const { file, takes, settled } = await twoTakes({ 'music/music.lock.json': '{ nope' })
    const view = await settled('hall')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    const answer = await takes.drop(file, 'hall', view.takes[0]!.file)
    expect(answer).toMatchObject({ ok: false, file: 'music/music.lock.json' })
  })

  it('tells the view the lock cannot be read, and not when it can', async () => {
    const bad = await twoTakes({ 'music/music.lock.json': '{ nope' })
    const unread = await bad.settled('hall')
    if (!unread || !('ok' in unread) || !unread.ok) throw new Error('expected a view')
    expect(unread.lockUnread).toBe(true)
    expect(unread.takes.map((t) => t.chosen)).toEqual([false, false])
    const good = await twoTakes()
    const read = await good.settled('hall')
    if (!read || !('ok' in read) || !read.ok) throw new Error('expected a view')
    expect(read.lockUnread).toBe(false)
  })
})

describe('moving a take', () => {
  const lists = {
    'tts/act1/music.json': [
      { id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 30 },
      { id: 'inn', title: 'Inn', brief: 'jolly', seconds: 40 },
    ],
    'tts/act2/music.json': [{ id: 'hut', title: 'Hut', brief: 'eerie', seconds: 20 }],
    'tts/stingers.json': [
      { id: 'victory', title: 'Victory', brief: 'fanfare', seconds: 6 },
      { id: 'defeat', title: 'Defeat', brief: 'sad', seconds: 5 },
    ],
  }
  async function made(count = 2, extra: Record<string, unknown> = {}) {
    const m = setup(undefined, { ...lists, ...extra })
    await m.takes.make(m.file, 'hall', { count })
    await m.settled('hall')
    return m
  }
  const viewOf = async (m: Awaited<ReturnType<typeof made>>, id: string) => {
    const view = await m.takes.view(m.file, id)
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    return view
  }
  const lockOf = (root: string) =>
    JSON.parse(readFileSync(join(root, 'music/music.lock.json'), 'utf8'))

  it('moves a take to a loop in another act as that loop’s next take, sound and all', async () => {
    const m = await made()
    await m.takes.make(m.file, 'hut', { count: 1 })
    await m.settled('hut')
    const [one, two] = (await viewOf(m, 'hall')).takes
    expect(await m.takes.move(m.file, 'hall', two!.file, 'hut')).toEqual({ ok: true, n: 2 })
    const hall = await viewOf(m, 'hall')
    expect(hall.takes.map((t) => t.n)).toEqual([one!.n])
    expect(existsSync(join(m.root, '.content-studio/music-takes/hall', two!.file))).toBe(false)
    const hut = await viewOf(m, 'hut')
    expect(hut.takes.map((t) => t.n)).toEqual([1, 2])
    const moved = hut.takes[1]!
    expect(moved).toMatchObject({
      seconds: two!.seconds,
      seed: two!.seed,
      peaks: two!.peaks,
      earlier: false,
      chosen: false,
      movedFrom: { title: 'Hall', n: 2 },
    })
    expect(existsSync(join(m.root, '.content-studio/music-takes/hut', moved.file))).toBe(true)
    expect(hut.takes[0]!.movedFrom).toBeUndefined()
  })

  it('counts the moved take as made for the new brief: chosen is plain chosen, and a later change marks it', async () => {
    const m = await made()
    const [one] = (await viewOf(m, 'hall')).takes
    expect(await m.takes.move(m.file, 'hall', one!.file, 'hut')).toEqual({ ok: true, n: 1 })
    const hut = await viewOf(m, 'hut')
    expect(await m.takes.choose(m.file, 'hut', hut.takes[0]!.file)).toEqual({ ok: true })
    expect(lockOf(m.root).hut.inputs).toMatchObject({ brief: 'eerie', seconds: 20 })
    const loaded = await loadProject(m.file)
    if (!loaded.ok) throw new Error('project')
    const row = loaded.summary.music!.lists.flatMap((l) => l.tracks).find((t) => t.id === 'hut')!
    expect(row.status).toBe('chosen')
    expect((await viewOf(m, 'hut')).takes[0]!.movedFrom).toEqual({ title: 'Hall', n: 1 })
    await setTrackBrief(m.file, 'hut', { brief: 'sinister' })
    const after = await loadProject(m.file)
    if (!after.ok) throw new Error('project')
    const changed = after.summary.music!.lists.flatMap((l) => l.tracks).find((t) => t.id === 'hut')!
    expect(changed.status).toBe('changed')
  })

  it('numbers after a take being made at the destination', async () => {
    let release = () => {}
    const m = setup(undefined, lists, [], new Promise<void>((resolve) => (release = resolve)))
    await m.takes.make(m.file, 'hut', { count: 2 })
    // Takes 1 and 2 of the hut are waiting; hall has a take from the board file.
    release()
    await m.settled('hut')
    await m.takes.make(m.file, 'hall', { count: 1 })
    await m.settled('hall')
    const [take] = (await viewOf(m, 'hall')).takes
    expect(await m.takes.move(m.file, 'hall', take!.file, 'hut')).toEqual({ ok: true, n: 3 })
  })

  it('moves a stinger to a stinger', async () => {
    const m = setup(undefined, lists)
    await m.takes.make(m.file, 'victory', { count: 1 })
    await m.settled('victory')
    const [take] = (await viewOf(m, 'victory')).takes
    expect(await m.takes.move(m.file, 'victory', take!.file, 'defeat')).toEqual({ ok: true, n: 1 })
    expect((await viewOf(m, 'victory')).takes).toEqual([])
    expect((await viewOf(m, 'defeat')).takes[0]).toMatchObject({ earlier: false })
  })

  it('refuses what cannot move, naming why, and changes nothing', async () => {
    const m = await made()
    const [one, two] = (await viewOf(m, 'hall')).takes
    await m.takes.choose(m.file, 'hall', one!.file)
    const refused = async (name: string, to: string, message: string) => {
      expect(await m.takes.move(m.file, 'hall', name, to)).toEqual({ ok: false, message })
    }
    await refused(one!.file, 'hut', 'That take is the one in the game; choose another first.')
    await refused(
      two!.file,
      'victory',
      'A loop can only move to a loop, and a stinger to a stinger.',
    )
    await refused(two!.file, 'hall', 'A take cannot move to the track it is on.')
    await refused(two!.file, 'nope', 'That track is not in the game’s list.')
    await refused('0123456789abcdef.9.wav', 'hut', 'That take is not on the board.')
    expect((await viewOf(m, 'hall')).takes).toHaveLength(2)
    expect((await viewOf(m, 'hut')).takes).toHaveLength(0)
    expect(await m.takes.move(m.file, 'nope', two!.file, 'hut')).toBeNull()
  })

  it('refuses while the music lock cannot be read', async () => {
    const m = await made(2, { 'music/music.lock.json': '{ nope' })
    const [one] = (await viewOf(m, 'hall')).takes
    expect(await m.takes.move(m.file, 'hall', one!.file, 'hut')).toEqual({
      ok: false,
      message: 'The music lock could not be read.',
    })
  })

  it('refuses a take whose sound is gone', async () => {
    const m = await made()
    const [one] = (await viewOf(m, 'hall')).takes
    // Board entry kept, file removed behind the studio's back.
    const board = join(m.root, '.content-studio/music/hall.json')
    const text = readFileSync(board, 'utf8')
    const gone = join(m.root, '.content-studio/music-takes/hall', one!.file)
    rmSync(gone)
    expect(await m.takes.move(m.file, 'hall', one!.file, 'hut')).toMatchObject({ ok: false })
    expect(readFileSync(board, 'utf8')).toBe(text)
  })

  it('refuses while the destination’s list is being refreshed from the game', async () => {
    const json = projectJson({ music })
    ;(json.narration as Record<string, unknown>).refreshDialog = 'sleep 1'
    const m = await made(2, { 'content-studio.json': json })
    const [one] = (await viewOf(m, 'hall')).takes
    const refreshing = refreshDialog(m.file, 'act2')
    try {
      expect(await m.takes.move(m.file, 'hall', one!.file, 'hut')).toEqual({
        ok: false,
        message: 'Hut is being refreshed from the game.',
      })
    } finally {
      stopAll()
      await refreshing.catch(() => {})
    }
    expect((await viewOf(m, 'hall')).takes).toHaveLength(2)
  })

  it('refuses while the source’s list is being refreshed, and while the stingers are', async () => {
    const json = projectJson({ music: { ...music, refreshShared: 'sleep 1' } })
    ;(json.narration as Record<string, unknown>).refreshDialog = 'sleep 1'
    const m = await made(2, { 'content-studio.json': json })
    const [one] = (await viewOf(m, 'hall')).takes
    const refreshing = refreshDialog(m.file, 'act1')
    try {
      expect(await m.takes.move(m.file, 'hall', one!.file, 'hut')).toEqual({
        ok: false,
        message: 'Hall is being refreshed from the game.',
      })
    } finally {
      stopAll()
      await refreshing.catch(() => {})
    }
    await m.takes.make(m.file, 'victory', { count: 1 })
    await m.settled('victory')
    const [take] = (await viewOf(m, 'victory')).takes
    const shared = refreshShared(m.file)
    try {
      expect(await m.takes.move(m.file, 'victory', take!.file, 'defeat')).toEqual({
        ok: false,
        message: 'Victory is being refreshed from the game.',
      })
    } finally {
      stopAll()
      await shared.catch(() => {})
    }
    expect((await viewOf(m, 'victory')).takes).toHaveLength(1)
  })

  it('leaves the take on its board when the destination cannot be written', async () => {
    const m = await made()
    const [one] = (await viewOf(m, 'hall')).takes
    // The destination's takes folder is a file: its sound cannot be written.
    mkdirSync(join(m.root, '.content-studio/music-takes'), { recursive: true })
    writeFileSync(join(m.root, '.content-studio/music-takes/hut'), 'in the way')
    await expect(m.takes.move(m.file, 'hall', one!.file, 'hut')).rejects.toThrow()
    expect((await viewOf(m, 'hall')).takes).toHaveLength(2)
  })

  it('never loses the take when the boards cannot be written: it stays on the first', async () => {
    const m = await made()
    const [one] = (await viewOf(m, 'hall')).takes
    const folder = join(m.root, '.content-studio/music')
    chmodSync(folder, 0o555)
    try {
      await expect(m.takes.move(m.file, 'hall', one!.file, 'hut')).rejects.toThrow()
    } finally {
      chmodSync(folder, 0o755)
    }
    expect((await viewOf(m, 'hall')).takes).toHaveLength(2)
  })

  it('lands both of two opposite moves at once', async () => {
    const m = await made(1)
    await m.takes.make(m.file, 'hut', { count: 1 })
    await m.settled('hut')
    const a = (await viewOf(m, 'hall')).takes[0]!
    const b = (await viewOf(m, 'hut')).takes[0]!
    const answers = await Promise.all([
      m.takes.move(m.file, 'hall', a.file, 'hut'),
      m.takes.move(m.file, 'hut', b.file, 'hall'),
    ])
    expect(answers.map((x) => x && 'ok' in x && x.ok)).toEqual([true, true])
    expect((await viewOf(m, 'hall')).takes).toHaveLength(1)
    expect((await viewOf(m, 'hut')).takes).toHaveLength(1)
  })

  it('writes under .content-studio only', async () => {
    const m = await made()
    const [one] = (await viewOf(m, 'hall')).takes
    const before = readdirSync(m.root).sort()
    await m.takes.move(m.file, 'hall', one!.file, 'hut')
    expect(readdirSync(m.root).sort()).toEqual(before)
    expect(existsSync(join(m.root, 'music/music.lock.json'))).toBe(false)
  })
})

describe('fading a stinger take', () => {
  const fades = { in: 0.3, out: 1.5, shape: 'smooth' } as const

  /** A stinger with one take made, and the take's name. */
  async function stinger(extra: Record<string, unknown> = {}) {
    const made = setup(undefined, extra)
    await made.takes.make(made.file, 'victory', { count: 1 })
    const view = await made.settled('victory')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    return { ...made, name: view.takes[0]!.file, seconds: view.takes[0]!.seconds }
  }

  async function takeOf(made: Awaited<ReturnType<typeof stinger>>) {
    const view = await made.takes.view(made.file, 'victory')
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    return view.takes[0]!
  }

  const firstAndLast = (bytes: Uint8Array) => {
    const wav = readWav(bytes)
    const samples = new Int16Array(wav.data.buffer, wav.data.byteOffset, wav.data.length / 2)
    return [samples[0], samples[samples.length - 1]]
  }

  it('keeps the fades with a take that is not chosen, and writes nothing to the game', async () => {
    const made = await stinger()
    expect(await made.takes.setFades(made.file, 'victory', made.name, fades)).toEqual({ ok: true })
    expect((await takeOf(made)).fades).toEqual(fades)
    expect(made.spy.wavs).toHaveLength(0)
    expect(existsSync(join(made.root, 'music/music.lock.json'))).toBe(false)
  })

  it('writes the faded sound at once when the take is the chosen one, leaving the lock alone', async () => {
    const made = await stinger()
    await made.takes.choose(made.file, 'victory', made.name)
    const lock = readFileSync(join(made.root, 'music/music.lock.json'), 'utf8')
    expect(made.spy.wavs).toHaveLength(1)
    expect(await made.takes.setFades(made.file, 'victory', made.name, fades)).toEqual({ ok: true })
    expect(made.spy.wavs).toHaveLength(2)
    expect(firstAndLast(made.spy.wavs[1]!)).toEqual([0, 0])
    expect(made.spy.wavs[1]).not.toEqual(made.spy.wavs[0]!)
    expect(readFileSync(join(made.root, 'music/music.lock.json'), 'utf8')).toBe(lock)
    expect(await takeOf(made)).toMatchObject({ chosen: true, fades })
  })

  it('chooses a take that has fades with the faded sound', async () => {
    const made = await stinger()
    await made.takes.setFades(made.file, 'victory', made.name, fades)
    await made.takes.choose(made.file, 'victory', made.name)
    expect(firstAndLast(made.spy.wavs[0]!)).toEqual([0, 0])
  })

  it('removes the fades: the take is back as generated, in the game too', async () => {
    const made = await stinger()
    await made.takes.choose(made.file, 'victory', made.name)
    await made.takes.setFades(made.file, 'victory', made.name, fades)
    expect(await made.takes.setFades(made.file, 'victory', made.name, null)).toEqual({ ok: true })
    expect(made.spy.wavs).toHaveLength(3)
    expect(made.spy.wavs[2]).toEqual(made.spy.wavs[0]!)
    expect((await takeOf(made)).fades).toBeUndefined()
  })

  it('leaves an accepted change accepted: only the sound is written again', async () => {
    const made = await stinger()
    await made.takes.choose(made.file, 'victory', made.name)
    await setTrackBrief(made.file, 'victory', { brief: 'a drum' })
    expect(await made.takes.accept(made.file, 'victory')).toEqual({ ok: true })
    const lock = readFileSync(join(made.root, 'music/music.lock.json'), 'utf8')
    expect(await made.takes.setFades(made.file, 'victory', made.name, fades)).toEqual({ ok: true })
    expect(readFileSync(join(made.root, 'music/music.lock.json'), 'utf8')).toBe(lock)
    expect(await made.takes.setFades(made.file, 'victory', made.name, null)).toEqual({ ok: true })
    expect(readFileSync(join(made.root, 'music/music.lock.json'), 'utf8')).toBe(lock)
    const loaded = await loadProject(made.file)
    if (!loaded.ok) throw new Error('project')
    const row = loaded.summary.music!.lists.find((l) => l.kind === 'stingers')!.tracks[0]!
    expect(row.status).toBe('chosen')
  })

  it('changes nothing when the game file cannot be written', async () => {
    const made = await stinger()
    await made.takes.choose(made.file, 'victory', made.name)
    made.spy.fail = true
    const answer = await made.takes.setFades(made.file, 'victory', made.name, fades)
    expect(answer).toMatchObject({
      ok: false,
      message: expect.stringContaining('The disk is full.'),
    })
    expect((await takeOf(made)).fades).toBeUndefined()
  })

  it('refuses a loop, a take that is not there, fades too long, and an unknown track', async () => {
    const made = await stinger()
    await made.takes.make(made.file, 'hall', { count: 1 })
    const hall = await made.settled('hall')
    if (!hall || !('ok' in hall) || !hall.ok) throw new Error('expected a view')
    expect(await made.takes.setFades(made.file, 'hall', hall.takes[0]!.file, fades)).toMatchObject({
      ok: false,
    })
    expect(
      await made.takes.setFades(made.file, 'victory', '0123456789abcdef.9.wav', fades),
    ).toMatchObject({ ok: false })
    expect(
      await made.takes.setFades(made.file, 'victory', made.name, {
        in: 4,
        out: 4,
        shape: 'smooth',
      }),
    ).toEqual({ ok: false, message: tooLongLine(made.seconds) })
    expect(await made.takes.setFades(made.file, 'nope', made.name, fades)).toBeNull()
    expect((await takeOf(made)).fades).toBeUndefined()
  })

  it('refuses while the lock cannot be read', async () => {
    const made = await stinger({ 'music/music.lock.json': '{ nope' })
    expect(await made.takes.setFades(made.file, 'victory', made.name, fades)).toMatchObject({
      ok: false,
      file: 'music/music.lock.json',
    })
  })

  it('keeps the fades through a move and loses them with a drop', async () => {
    const made = await stinger({
      'tts/stingers.json': [
        { id: 'victory', title: 'Victory', brief: 'fanfare', seconds: 6 },
        { id: 'defeat', title: 'Defeat', brief: 'doom', seconds: 6 },
      ],
    })
    await made.takes.setFades(made.file, 'victory', made.name, fades)
    expect(await made.takes.move(made.file, 'victory', made.name, 'defeat')).toMatchObject({
      ok: true,
    })
    const moved = await made.takes.view(made.file, 'defeat')
    if (!moved || !('ok' in moved) || !moved.ok) throw new Error('expected a view')
    expect(moved.takes[0]!.fades).toEqual(fades)
    expect(await made.takes.drop(made.file, 'defeat', moved.takes[0]!.file)).toEqual({ ok: true })
    const board = readFileSync(join(made.root, '.content-studio/music/defeat.json'), 'utf8')
    expect(board).not.toContain('fades')
  })
})

describe('trimming a stinger take', () => {
  /** A mono 1000 Hz WAV of a second of near-silence, four of sound and a second of near-silence. */
  const padded = () => {
    const samples = new Int16Array(6000)
    samples.forEach((_, i) => {
      samples[i] = i < 1000 ? (i % 2 ? 50 : -50) : i < 5000 ? (i % 2 ? 8000 : -8000) : 100
    })
    return writeWav({
      format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
      data: new Uint8Array(samples.buffer),
    })
  }
  const lists = {
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 30 }],
    'tts/stingers.json': [
      { id: 'victory', title: 'Victory', brief: 'fanfare', seconds: 6 },
      { id: 'defeat', title: 'Defeat', brief: 'sad', seconds: 6 },
    ],
  }
  async function made(failEncode = false) {
    const encoded: Uint8Array[] = []
    let failing: boolean | Error = failEncode
    const encoder: Encoder = async (wav, out) => {
      if (failing instanceof Error) throw failing
      if (failing) throw new Error('the encoder broke')
      encoded.push(wav)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, `mp3 ${encoded.length}`)
    }
    const m = setup(undefined, lists, [], undefined, [], false, encoder)
    await m.takes.make(m.file, 'victory', { count: 2 })
    await m.settled('victory')
    const folder = join(m.root, '.content-studio/music-takes/victory')
    for (const name of readdirSync(folder)) writeFileSync(join(folder, name), padded())
    return { ...m, encoded, folder, fail: (on: boolean | Error) => (failing = on) }
  }
  type Made = Awaited<ReturnType<typeof made>>
  const viewOf = async (m: Made, id = 'victory') => {
    const view = await m.takes.view(m.file, id)
    if (!view || !('ok' in view) || !view.ok) throw new Error('expected a view')
    return view
  }
  const lockOf = (root: string) =>
    JSON.parse(readFileSync(join(root, 'music/music.lock.json'), 'utf8'))
  const manifestOf = (root: string) =>
    JSON.parse(readFileSync(join(root, 'audio/music/manifest.json'), 'utf8'))

  it('fades a trimmed take after the cut: the length is the part that is left, and the game gets both', async () => {
    const m = await made()
    const take = (await viewOf(m)).takes[0]!
    expect(await m.takes.choose(m.file, 'victory', take.file)).toEqual({ ok: true })
    expect(await m.takes.trim(m.file, 'victory', take.file, false)).toEqual({ ok: true })
    const left = (await viewOf(m)).takes[0]!.trim!.seconds
    const tooLong = { in: left, out: 1, shape: 'straight' } as const
    expect(await m.takes.setFades(m.file, 'victory', take.file, tooLong)).toMatchObject({
      ok: false,
    })
    const fades = { in: 0.5, out: 0.5, shape: 'straight' } as const
    expect(await m.takes.setFades(m.file, 'victory', take.file, fades)).toEqual({ ok: true })
    const sent = readWav(m.encoded.at(-1)!)
    expect(wavSeconds(sent)).toBeCloseTo(left, 3)
    const samples = new Int16Array(sent.data.buffer, sent.data.byteOffset, sent.data.length / 2)
    expect(samples[0]).toBe(0)
    expect(samples[samples.length - 1]).toBe(0)
    // The part asked for to be heard is the cut sound only; the fades come from the address.
    const heard = await m.takes.trimmedSound(m.file, 'victory', take.file)
    expect(wavSeconds(readWav(heard!))).toBeCloseTo(left, 3)
    expect(new Int16Array(readWav(heard!).data.buffer.slice(0, 2))[0]).not.toBe(0)
  })

  it('keeps the fades through a trim and its undo, on the chosen take', async () => {
    const m = await made()
    const take = (await viewOf(m)).takes[0]!
    const fades = { in: 2, out: 2, shape: 'straight' } as const
    expect(await m.takes.setFades(m.file, 'victory', take.file, fades)).toEqual({ ok: true })
    expect(await m.takes.choose(m.file, 'victory', take.file)).toEqual({ ok: true })
    expect(await m.takes.trim(m.file, 'victory', take.file, false)).toEqual({ ok: true })
    const ends = (bytes: Uint8Array) => {
      const wav = readWav(bytes)
      const samples = new Int16Array(wav.data.buffer, wav.data.byteOffset, wav.data.length / 2)
      return { seconds: wavSeconds(wav), first: samples[0], last: samples[samples.length - 1] }
    }
    const trimmed = (await viewOf(m)).takes[0]!
    expect(trimmed.fades).toEqual(fades)
    expect(ends(m.encoded.at(-1)!)).toEqual({
      seconds: expect.closeTo(trimmed.trim!.seconds, 3),
      first: 0,
      last: 0,
    })
    expect(await m.takes.trim(m.file, 'victory', take.file, true)).toEqual({ ok: true })
    expect(ends(m.encoded.at(-1)!)).toEqual({ seconds: expect.closeTo(6, 3), first: 0, last: 0 })
  })

  it('says what a stinger take has to cut, and a loop never does', async () => {
    const m = await made()
    expect((await viewOf(m)).takes[0]).toMatchObject({ trimmable: 'cut' })
    expect((await viewOf(m)).takes[0]).not.toHaveProperty('trim')
    await m.takes.make(m.file, 'hall', { count: 1 })
    await m.settled('hall')
    const loop = (await viewOf(m, 'hall')).takes[0]!
    expect(loop).not.toHaveProperty('trimmable')
  })

  it('says nothing to cut, and silent, from the take’s own sound', async () => {
    const m = await made()
    const [one, two] = (await viewOf(m)).takes
    const flat = (level: number) =>
      writeWav({
        format: readWav(padded()).format,
        data: new Uint8Array(new Int16Array(6000).fill(level).buffer),
      })
    writeFileSync(join(m.folder, one!.file), flat(8000))
    writeFileSync(join(m.folder, two!.file), flat(40))
    const view = await viewOf(m)
    expect(view.takes.map((t) => t.trimmable)).toEqual(['nothing', 'silent'])
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toMatchObject({ ok: false })
    expect(await m.takes.trim(m.file, 'victory', two!.file, false)).toMatchObject({ ok: false })
  })

  it('keeps the cut with the take, leaves its sound as generated, and undoes it', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    const before = readFileSync(join(m.folder, one!.file))
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toEqual({ ok: true })
    const trimmed = (await viewOf(m)).takes[0]!
    expect(trimmed.seconds).toBe(6)
    expect(trimmed.trim!.start).toBeCloseTo(0.95, 3)
    expect(trimmed.trim!.end).toBeCloseTo(0.95, 3)
    expect(trimmed.trim!.seconds).toBeCloseTo(4.1, 3)
    expect(trimmed).not.toHaveProperty('trimmable')
    expect(readFileSync(join(m.folder, one!.file)).equals(before)).toBe(true)
    const sound = await m.takes.trimmedSound(m.file, 'victory', one!.file)
    expect(wavSeconds(readWav(sound!))).toBeCloseTo(4.1, 3)
    expect(await m.takes.trim(m.file, 'victory', one!.file, true)).toEqual({ ok: true })
    expect((await viewOf(m)).takes[0]).toMatchObject({ trimmable: 'cut' })
  })

  it('refuses a loop, and a take that is not there', async () => {
    const m = await made()
    await m.takes.make(m.file, 'hall', { count: 1 })
    await m.settled('hall')
    const loop = (await viewOf(m, 'hall')).takes[0]!
    expect(await m.takes.trim(m.file, 'hall', loop.file, false)).toMatchObject({ ok: false })
    expect(await m.takes.trim(m.file, 'victory', 'nope.wav', false)).toMatchObject({ ok: false })
  })

  it('writes the trimmed sound and length into the game when a trimmed take is chosen', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    await m.takes.trim(m.file, 'victory', one!.file, false)
    expect(await m.takes.choose(m.file, 'victory', one!.file)).toEqual({ ok: true })
    expect(wavSeconds(readWav(m.encoded[0]!))).toBeCloseTo(4.1, 3)
    expect(manifestOf(m.root).victory.duration).toBeCloseTo(4.1, 1)
  })

  it('rewrites the game’s file at once when the take in the game is trimmed and untrimmed', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    await m.takes.choose(m.file, 'victory', one!.file)
    expect(wavSeconds(readWav(m.encoded[0]!))).toBeCloseTo(6, 3)
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toEqual({ ok: true })
    expect(wavSeconds(readWav(m.encoded[1]!))).toBeCloseTo(4.1, 3)
    expect(manifestOf(m.root).victory.duration).toBeCloseTo(4.1, 1)
    expect((await viewOf(m)).takes[0]).toMatchObject({ chosen: true })
    expect(lockOf(m.root).victory).toMatchObject({ take: 1 })
    expect(await m.takes.trim(m.file, 'victory', one!.file, true)).toEqual({ ok: true })
    expect(wavSeconds(readWav(m.encoded[2]!))).toBeCloseTo(6, 3)
    expect(manifestOf(m.root).victory.duration).toBe(6)
    expect((await viewOf(m)).takes[0]).toMatchObject({ chosen: true, trimmable: 'cut' })
  })

  it('changes neither the take nor the game’s file when the game’s file cannot be written', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    await m.takes.choose(m.file, 'victory', one!.file)
    m.fail(true)
    const answer = await m.takes.trim(m.file, 'victory', one!.file, false)
    expect(answer).toMatchObject({ ok: false, message: 'the encoder broke' })
    expect((await viewOf(m)).takes[0]).toMatchObject({ trimmable: 'cut' })
    expect(readFileSync(join(m.root, 'audio/music/victory.mp3'), 'utf8')).toBe('mp3 1')
    expect(manifestOf(m.root).victory.duration).toBe(6)
  })

  it('says the game’s file could not be written when the take in the game cannot be trimmed or untrimmed there', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    await m.takes.choose(m.file, 'victory', one!.file)
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toEqual({ ok: true })
    m.fail(new FileNotWritten())
    const reason = { ok: false, message: 'The game’s file could not be written' } as const
    expect(await m.takes.trim(m.file, 'victory', one!.file, true)).toEqual(reason)
    m.fail(false)
    expect(await m.takes.trim(m.file, 'victory', one!.file, true)).toEqual({ ok: true })
    m.fail(new FileNotWritten())
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toEqual(reason)
  })

  it('keeps an accepted brief change and the time of the choice when the take in the game is trimmed', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    await m.takes.choose(m.file, 'victory', one!.file)
    const before = lockOf(m.root).victory
    await setTrackBrief(m.file, 'victory', { brief: 'a louder fanfare' })
    expect(await m.takes.accept(m.file, 'victory')).toEqual({ ok: true })
    const accepted = lockOf(m.root).victory
    expect(accepted.inputs.brief).toBe('a louder fanfare')
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toEqual({ ok: true })
    expect(lockOf(m.root).victory.inputs).toEqual(accepted.inputs)
    expect(lockOf(m.root).victory.at).toBe(before.at)
  })

  it('refuses while the music lock cannot be read, changing nothing', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    mkdirSync(join(m.root, 'music'), { recursive: true })
    writeFileSync(join(m.root, 'music/music.lock.json'), '{ not json')
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toMatchObject({
      ok: false,
      message: 'The music lock could not be read.',
    })
    expect((await viewOf(m)).takes[0]).not.toHaveProperty('trim')
  })

  it('gives a plain reason when the game’s manifest cannot be read', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    await m.takes.choose(m.file, 'victory', one!.file)
    writeFileSync(join(m.root, 'audio/music/manifest.json'), '{ not json')
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toEqual({
      ok: false,
      message: 'the music manifest could not be read',
    })
  })

  it('says the sound file could not be read for a WAV that cannot be parsed', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    writeFileSync(join(m.folder, one!.file), 'not a wav')
    expect(await m.takes.trim(m.file, 'victory', one!.file, false)).toEqual({
      ok: false,
      message: 'The take’s sound file could not be read.',
    })
  })

  it('keeps the trim on a take moved to another stinger', async () => {
    const m = await made()
    const [one] = (await viewOf(m)).takes
    await m.takes.trim(m.file, 'victory', one!.file, false)
    expect(await m.takes.move(m.file, 'victory', one!.file, 'defeat')).toMatchObject({ ok: true })
    const moved = (await viewOf(m, 'defeat')).takes[0]!
    expect(moved.trim!.seconds).toBeCloseTo(4.1, 3)
    expect(await m.takes.trim(m.file, 'defeat', moved.file, true)).toEqual({ ok: true })
  })
})
