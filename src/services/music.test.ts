import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { wavSeconds } from '../core/musicTake'
import { readWav } from '../core/wav'
import {
  aceStepCheckpoints,
  aceStepReady,
  createAceStepWorker,
  createMusicRouter,
  missingFolders,
  type MusicGenerator,
  type MusicReady,
} from './music'

const dir0 = mkdtempSync(join(tmpdir(), 'content-studio-ace-log-'))
afterAll(() => rmSync(dir0, { recursive: true, force: true }))
const fake = join(import.meta.dir, '../../test/fixtures/fake-acestep.ts')
const worker = createAceStepWorker({ command: [process.execPath, fake] })
afterAll(() => worker.close())

const request = {
  kind: 'loop',
  seconds: 3,
  bpm: null,
  key: null,
  seed: 42,
  model: 'balanced',
} as const

describe('createAceStepWorker', () => {
  it('gives the WAV the worker made and the seed it was made from', async () => {
    const take = await worker.generate({ ...request, brief: 'gentle lute' })
    expect(take.seed).toBe(42)
    expect(wavSeconds(readWav(take.wav))).toBe(3)
  })

  it('passes on the worker’s error, and keeps working', async () => {
    await expect(worker.generate({ ...request, brief: 'fail' })).rejects.toThrow(
      'The music generator: out of memory',
    )
    expect((await worker.generate({ ...request, brief: 'ok' })).seed).toBe(42)
  })

  it('reports a worker that dies, and starts a new one next time', async () => {
    await expect(worker.generate({ ...request, brief: 'crash' })).rejects.toThrow(
      'The music generator stopped (exit code 3)',
    )
    expect((await worker.generate({ ...request, brief: 'again' })).seed).toBe(42)
  })

  it('says plainly why, and what to do, when the system kills the worker', async () => {
    const take = worker.generate({ ...request, brief: 'killed' })
    await expect(take).rejects.toThrow(
      'The music generator was stopped by the computer, most likely because it ran out of memory. Close other music jobs, then Try again.',
    )
    await expect(take).rejects.not.toThrow('acestep')
    expect((await worker.generate({ ...request, brief: 'again' })).seed).toBe(42)
  })

  it('ends a take at once when it is stopped, and makes the next one', async () => {
    const stop = new AbortController()
    const take = worker.generate({ ...request, brief: 'hang' }, stop.signal)
    stop.abort()
    await expect(take).rejects.toThrow('The music generator stopped')
    await expect(
      worker.generate({ ...request, brief: 'never' }, AbortSignal.abort()),
    ).rejects.toThrow('The music generator was stopped.')
    expect((await worker.generate({ ...request, brief: 'again' })).seed).toBe(42)
  })

  it('says what is missing when the worker cannot start', async () => {
    const missing = createAceStepWorker({ command: ['no-such-command-xyz'] })
    await expect(missing.generate({ ...request, brief: 'a' })).rejects.toThrow(
      'The music generator could not start',
    )
    missing.close()
  })
})

describe('aceStepCheckpoints', () => {
  it('is the folder the environment names, else one under the home folder’s cache', () => {
    expect(aceStepCheckpoints({ ACESTEP_CHECKPOINTS: '/models' })).toBe('/models')
    expect(aceStepCheckpoints({})).toMatch(/\.cache\/ace-step\/checkpoints$/)
  })
})

describe('aceStepReady', () => {
  const mac = { which: () => true, platform: 'darwin', arch: 'arm64' }
  const dir = mkdtempSync(join(tmpdir(), 'content-studio-ace-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('says what is missing, in the order it can be fixed', () => {
    const none = { ...mac, platform: 'linux' }
    expect(aceStepReady(none, dir)).toMatchObject({
      ok: false,
      message: 'ACE-Step runs on macOS with Apple silicon only.',
      fix: expect.stringContaining('Apple silicon'),
    })
    expect(aceStepReady({ ...mac, which: () => false }, dir)).toMatchObject({
      ok: false,
      message: 'uv is not on the PATH; it runs the music worker.',
      fix: expect.stringContaining('brew install uv'),
    })
    expect(aceStepReady(mac, dir)).toMatchObject({
      ok: false,
      message: expect.stringContaining('acestep-v15-xl-turbo'),
      fix: expect.stringContaining('acestep-5Hz-lm-4B'),
    })
  })

  it('is ready with both model folders in place', () => {
    mkdirSync(join(dir, 'acestep-v15-xl-turbo'))
    mkdirSync(join(dir, 'acestep-5Hz-lm-4B'))
    expect(aceStepReady(mac, dir)).toEqual({ ok: true })
  })

  it('asks for the folders of the model it is asked about, and names it', () => {
    const careful = aceStepReady(mac, dir, 'careful')
    expect(careful).toMatchObject({
      ok: false,
      message: `The project's music model, Careful, is not on this computer: acestep-v15-xl-sft is missing from ${dir}.`,
      fix: expect.stringContaining('acestep-v15-xl-sft and acestep-5Hz-lm-4B'),
    })
    expect(aceStepReady(mac, dir, 'quick')).toMatchObject({
      message: expect.stringContaining('acestep-5Hz-lm-1.7B'),
    })
  })

  it('writes the home folder as ~ in what is missing', () => {
    const checkpoints = join(homedir(), '.content-studio-no-such-checkpoints')
    expect(aceStepReady(mac, checkpoints)).toMatchObject({
      message: expect.stringContaining('missing from ~/.content-studio-no-such-checkpoints.'),
    })
  })

  it('does not ask for ACE-Step’s folders when the project’s model is a Stable Audio one', () => {
    expect(aceStepReady(mac, join(dir, 'nothing-here'), 'short')).toEqual({ ok: true })
  })

  it('lists the folders of a model that are missing', () => {
    expect(missingFolders(dir, 'balanced')).toEqual([])
    expect(missingFolders(dir, 'quickest')).toEqual(['acestep-v15-turbo', 'acestep-5Hz-lm-1.7B'])
  })
})

describe('the worker’s request', () => {
  it('names the model’s two folders', async () => {
    const seen = join(dir0, 'request.json')
    process.env.FAKE_ACESTEP_LOG = seen
    const spy = createAceStepWorker({ command: [process.execPath, fake] })
    try {
      await spy.generate({ ...request, brief: 'a', model: 'careful' })
    } finally {
      spy.close()
      delete process.env.FAKE_ACESTEP_LOG
    }
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toMatchObject({
      dit: 'acestep-v15-xl-sft',
      lm: 'acestep-5Hz-lm-4B',
    })
  })
})

describe('createMusicRouter', () => {
  const make = (name: string, log: string[]): MusicGenerator => ({
    ready: (model) => ({ ok: model !== 'careful', message: name, fix: '' }) as MusicReady,
    installed: (model) => model !== 'quick',
    generate: async (r) => {
      log.push(`${name}:generate:${r.model}`)
      return { wav: new Uint8Array(), seed: 1 }
    },
    close: () => void log.push(`${name}:close`),
  })

  it('sends each model to its own generator, and closes the other when the family changes', async () => {
    const log: string[] = []
    const router = createMusicRouter({
      acestep: make('ace', log),
      'stable-audio': make('sa', log),
      elevenlabs: make('el', log),
    })
    const base = { brief: 'a', kind: 'loop', seconds: 3, bpm: null, key: null, seed: 1 } as const
    await router.generate({ ...base, model: 'balanced' })
    await router.generate({ ...base, model: 'quick' })
    await router.generate({ ...base, model: 'short' })
    await router.generate({ ...base, model: 'shortest' })
    await router.generate({ ...base, model: 'balanced' })
    expect(log).toEqual([
      'ace:generate:balanced',
      'ace:generate:quick',
      'ace:close',
      'sa:generate:short',
      'sa:generate:shortest',
      'sa:close',
      'ace:generate:balanced',
    ])
  })

  it('stops no local worker for a take made in the cloud', async () => {
    const log: string[] = []
    const router = createMusicRouter({
      acestep: make('ace', log),
      'stable-audio': make('sa', log),
      elevenlabs: make('el', log),
    })
    const base = { brief: 'a', kind: 'loop', seconds: 3, bpm: null, key: null, seed: 1 } as const
    await router.generate({ ...base, model: 'balanced' })
    await router.generate({ ...base, model: 'eleven' })
    await router.generate({ ...base, model: 'balanced' })
    await router.generate({ ...base, model: 'short' })
    expect(log).toEqual([
      'ace:generate:balanced',
      'el:generate:eleven',
      'ace:generate:balanced',
      'ace:close',
      'sa:generate:short',
    ])
  })

  it('asks the generator of the model’s family whether it is ready and installed', async () => {
    const router = createMusicRouter({
      acestep: make('ace', []),
      'stable-audio': make('sa', []),
      elevenlabs: make('el', []),
    })
    expect(router.installed('quick')).toBe(false)
    expect(router.installed('short')).toBe(true)
    expect((await router.ready('careful')).ok).toBe(false)
    expect(router.ready('short')).toMatchObject({ ok: true })
  })

  it('stops every family', () => {
    const log: string[] = []
    createMusicRouter({
      acestep: make('ace', log),
      'stable-audio': make('sa', log),
      elevenlabs: make('el', log),
    }).close()
    expect(log.sort()).toEqual(['ace:close', 'el:close', 'sa:close'])
  })
})
