import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wavSeconds } from '../core/musicTake'
import { readWav } from '../core/wav'
import { aceStepCheckpoints, aceStepReady, createAceStepWorker } from './music'

const fake = join(import.meta.dir, '../../test/fixtures/fake-acestep.ts')
const worker = createAceStepWorker({ command: [process.execPath, fake] })
afterAll(() => worker.close())

const request = { kind: 'loop', seconds: 3, bpm: null, key: null, seed: 42 } as const

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
  const dir = mkdtempSync(join(tmpdir(), 'audio-studio-ace-'))
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
})
