import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { wavSeconds } from '../core/musicTake'
import { readWav } from '../core/wav'
import {
  STABLE_AUDIO_DIR,
  createStableAudioWorker,
  missingStableAudio,
  stableAudioReady,
} from './stableAudio'

const mac = { which: () => true, platform: 'darwin', arch: 'arm64' }
const dir = mkdtempSync(join(tmpdir(), 'audio-studio-stable-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const fake = join(import.meta.dir, '../../test/fixtures/fake-acestep.ts')

describe('where the models are looked for', () => {
  it('is a folder of its own in the home folder’s cache, set by no environment variable', () => {
    expect(STABLE_AUDIO_DIR).toBe(join(homedir(), '.cache', 'stable-audio'))
  })
})

describe('stableAudioReady', () => {
  it('says what is missing, in the order it can be fixed', () => {
    expect(stableAudioReady({ ...mac, platform: 'linux' }, dir, 'short')).toMatchObject({
      ok: false,
      message: 'Stable Audio Open runs on macOS with Apple silicon only.',
    })
    expect(stableAudioReady({ ...mac, which: () => false }, dir, 'short')).toMatchObject({
      ok: false,
      message: 'uv is not on the PATH; it runs the music worker.',
      fix: expect.stringContaining('brew install uv'),
    })
    expect(stableAudioReady(mac, dir, 'short')).toMatchObject({
      ok: false,
      message: `Short is not on this computer: stable-audio-open-1.0 is missing from ${dir}.`,
      fix: expect.stringContaining('Setup'),
    })
  })

  it('is ready when the model’s own folder is there', () => {
    mkdirSync(join(dir, 'stable-audio-open-1.0'))
    expect(stableAudioReady(mac, dir, 'short')).toEqual({ ok: true })
    expect(stableAudioReady(mac, dir, 'shortest').ok).toBe(false)
  })

  it('lists the folders missing', () => {
    expect(missingStableAudio(dir, 'short')).toEqual([])
    expect(missingStableAudio(dir, 'shortest')).toEqual(['stable-audio-open-small'])
  })
})

describe('createStableAudioWorker', () => {
  const request = { kind: 'stinger', seconds: 3, bpm: null, key: null, seed: 5 } as const

  it('makes a take with the model’s folder named, and says which models are here', async () => {
    const seen = join(dir, 'request.json')
    process.env.FAKE_ACESTEP_LOG = seen
    const worker = createStableAudioWorker({ command: [process.execPath, fake], dir })
    try {
      const take = await worker.generate({ ...request, brief: 'a bell', model: 'short' })
      expect(take.seed).toBe(5)
      expect(wavSeconds(readWav(take.wav))).toBe(3)
      expect(worker.installed('short')).toBe(true)
      expect(worker.installed('shortest')).toBe(false)
    } finally {
      worker.close()
      delete process.env.FAKE_ACESTEP_LOG
    }
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toMatchObject({
      model_dir: join(dir, 'stable-audio-open-1.0'),
      brief: 'a bell',
    })
  })

  it('says what is missing when the worker cannot start', async () => {
    const missing = createStableAudioWorker({ command: ['no-such-command-xyz'], dir })
    await expect(missing.generate({ ...request, brief: 'a', model: 'short' })).rejects.toThrow(
      'The music generator could not start',
    )
    missing.close()
  })
})
