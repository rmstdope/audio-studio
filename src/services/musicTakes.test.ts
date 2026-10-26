import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { wavSeconds } from '../core/musicTake'
import { readWav, writeWav } from '../core/wav'
import { projectJson, tempRepo } from '../../test/helpers'
import { setTrackBrief } from './briefs'
import { createSerial } from './serial'
import type { MusicGenerator, MusicReady, MusicRequest } from './music'
import type { Encoder } from './audio'
import { loadProject } from './workspace'
import { boardQueue, createMusicTakes, musicTakeHash } from './musicTakes'
import { GPU } from './gpu'
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

/** A generator that makes a tone as long as asked (at 1000 Hz), and fails for a brief saying "fail". */
function fakeGenerator(
  ready: MusicReady = { ok: true },
  failOn: number[] = [],
  gate?: Promise<void>,
  missing: string[] = [],
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
      return { wav: writeWav({ format, data: new Uint8Array(samples.buffer) }), seed: request.seed }
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
) {
  const root = tempRepo({
    'audio-studio.json': projectJson({ music }),
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', brief: 'warm lute', seconds: 30 }],
    'tts/stingers.json': [{ id: 'victory', title: 'Victory', brief: 'fanfare', seconds: 6 }],
    ...extra,
  })
  const file = join(root, 'audio-studio.json')
  const { generator, requests } = fakeGenerator(ready, failOn, gate, missing)
  let seed = 100
  const encode: Encoder = async (_wav, out) => {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, 'mp3')
  }
  const takes = createMusicTakes({
    generator,
    encode,
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
  return { root, file, takes, requests, settled }
}

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
    expect(path).toStartWith(join(root, '.audio-studio/music-takes/hall/'))
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
    const board = JSON.parse(readFileSync(join(root, '.audio-studio/music/hall.json'), 'utf8'))
    expect(board.next).toBe(3)
    expect(board.takes.map((t: { n: number }) => t.n)).toEqual([1, 2])
    expect(
      readdirSync(join(root, '.audio-studio/music-takes/hall')).some((f) => f.endsWith('.json')),
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
    const { file, takes } = setup(undefined, { '.audio-studio/music/hall.json': '{ nope' })
    const view = await takes.view(file, 'hall')
    expect(view).toMatchObject({ ok: false })
    expect(JSON.stringify(view)).toContain('.audio-studio/music/hall.json')
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
    expect(existsSync(join(root, '.audio-studio/music-takes/hall', first!.file))).toBe(false)
    expect(await takes.view(file, 'hall')).toMatchObject({ takes: [{ n: second!.n }] })
  })

  it('refuses to drop what is not on the board, and an unknown track, writing nothing', async () => {
    const { root, file, takes } = setup()
    expect(await takes.drop(file, 'hall', 'aaaaaaaaaaaaaaaa.1.wav')).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
    expect(await takes.drop(file, 'hall', '../../audio-studio.json')).toEqual({
      ok: false,
      message: 'That take is not on the board.',
    })
    expect(await takes.drop(file, 'nope', 'aaaaaaaaaaaaaaaa.1.wav')).toBeNull()
    expect(existsSync(join(root, '.audio-studio/music/hall.json'))).toBe(false)
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
    expect(readdirSync(join(root, '.audio-studio/music-takes/hall'))).toHaveLength(1)
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
    const folder = join(root, '.audio-studio/music-takes/hall')
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
      hall: { takes: 2, left: 120 + 180 },
      victory: { takes: 1, left: 180 },
    })
    release()
    for (let i = 0; i < 200 && Object.keys(await takes.making(file)).length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(await takes.making(file)).toEqual({})
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
      'audio-studio.json': projectJson({ music: { ...music, model: 'short' } }),
    })
    expect(await takes.make(file, 'hall', { count: 1 })).toMatchObject({ ok: false })
    expect(await takes.make(file, 'victory', { count: 1 })).toEqual({ ok: true })
  })

  it('uses the project’s model when none is asked for', async () => {
    const { file, takes, requests, settled } = setup(undefined, {
      'audio-studio.json': projectJson({ music: { ...music, model: 'quickest' } }),
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
    const board = join(root, '.audio-studio/music/hall.json')
    const saved = JSON.parse(readFileSync(board, 'utf8'))
    delete saved.takes[0].model
    writeFileSync(board, JSON.stringify(saved))
    const view = await takes.view(file, 'hall')
    expect(view).toMatchObject({ takes: [{ model: 'Balanced · XL turbo · 4B' }] })
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
    expect(failed).toMatchObject({ failed: [{ n: 1, model: 'Careful · XL sft · 4B' }] })
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
        { n: 1, model: 'Careful · XL sft · 4B', expected: 420 },
        { n: 2, model: 'Quickest · Turbo · 1.7B', expected: 60 },
      ],
    })
    expect(await takes.making(file)).toEqual({ hall: { takes: 2, left: 480 } })
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
    const bare = tempRepo({ 'audio-studio.json': projectJson() })
    expect(await takes.view(join(bare, 'audio-studio.json'), 'hall')).toBeNull()
  })

  it('serves only a take’s own file name', async () => {
    const { file, takes, settled } = setup()
    await takes.make(file, 'hall', { count: 1 })
    await settled('hall')
    expect(await takes.takeFile(file, 'hall', '../../../audio-studio.json')).toBeNull()
    expect(await takes.takeFile(file, 'hall', 'aaaaaaaaaaaaaaaa.1.wav')).toBeNull()
  })

  it('writes under .audio-studio/music-takes and nowhere else', async () => {
    const { root, file, takes, settled } = setup()
    const before = readdirSync(root, { recursive: true }).map(String)
    await takes.make(file, 'hall', { count: 2 })
    await settled('hall')
    const added = readdirSync(root, { recursive: true })
      .map(String)
      .filter((f) => !before.includes(f))
      .filter((f) => !f.startsWith('.audio-studio'))
    expect(added).toEqual([])
    expect(existsSync(join(root, '.audio-studio/music-takes/hall'))).toBe(true)
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
    expect(existsSync(join(root, '.audio-studio/music-takes/hall', one!.file))).toBe(true)
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
})
