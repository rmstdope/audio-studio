import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWav } from '../core/wav'
import { createEffectsWorker } from './effects'

const fake = join(import.meta.dir, '../../test/fixtures/fake-effects.ts')
const command = [process.execPath, fake]

describe('createEffectsWorker', () => {
  it('makes a take from a description, a length and a seed, with its trailing silence trimmed', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'content-studio-effects-')), 'request.json')
    process.env.FAKE_EFFECTS_LOG = log
    const worker = createEffectsWorker({ command })
    try {
      const take = await worker.generate({ prompt: 'a door creak', seconds: 4, seed: 9 })
      expect(take.seed).toBe(9)
      const wav = readWav(take.wav)
      // The fake makes 4 s with sound in the first 2; the take ends 20 ms after the sound.
      expect(wav.data.length / 4).toBeGreaterThan(1990)
      expect(wav.data.length / 4).toBeLessThan(2030)
    } finally {
      await worker.close()
      delete process.env.FAKE_EFFECTS_LOG
    }
    expect(JSON.parse(readFileSync(log, 'utf8'))).toMatchObject({
      prompt: 'a door creak',
      seconds: 4,
      seed: 9,
    })
  })

  it('rejects with the worker’s error, and says what is missing when it cannot start', async () => {
    const worker = createEffectsWorker({ command })
    await expect(worker.generate({ prompt: 'fail', seconds: 1, seed: 1 })).rejects.toThrow(
      'out of memory',
    )
    await worker.close()
    const missing = createEffectsWorker({ command: ['no-such-command-xyz'] })
    await expect(missing.generate({ prompt: 'a', seconds: 1, seed: 1 })).rejects.toThrow(
      'The effects generator could not start',
    )
    await missing.close()
  })

  it('stops at once when aborted', async () => {
    const worker = createEffectsWorker({ command })
    const stop = new AbortController()
    stop.abort()
    await expect(
      worker.generate({ prompt: 'a', seconds: 1, seed: 1 }, stop.signal),
    ).rejects.toThrow('The effects generator was stopped.')
    await worker.close()
  })

  it('says how much of the model is downloaded, from the Hugging Face cache', () => {
    const hubDir = mkdtempSync(join(tmpdir(), 'content-studio-hub-'))
    try {
      expect(createEffectsWorker({ command, hubDir }).download()).toBe('absent')
    } finally {
      rmSync(hubDir, { recursive: true, force: true })
    }
  })
})
