import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWav } from '../core/wav'
import { writeWav } from '../core/wav'
import {
  createEffectGenerator,
  createEffectsWorker,
  createOpenEffects,
  type ModelEffects,
} from './effects'
import type { GeneratedTake, MusicGenerator, MusicRequest } from './music'

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

  it('tells the worker nothing of looping: it is told the words, the length and the seed', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'content-studio-effects-')), 'request.json')
    process.env.FAKE_EFFECTS_LOG = log
    const worker = createEffectsWorker({ command })
    try {
      await worker.generate({ prompt: 'rain', seconds: 12, seed: 3, loops: true })
    } finally {
      await worker.close()
      delete process.env.FAKE_EFFECTS_LOG
    }
    expect(Object.keys(JSON.parse(readFileSync(log, 'utf8'))).sort()).toEqual([
      'id',
      'out',
      'prompt',
      'seconds',
      'seed',
    ])
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

/** A WAV of `seconds` at 1000 Hz: a tone for the first half, silence after. */
function tone(seconds: number): Uint8Array {
  const rate = 1000
  const frames = Math.round(seconds * rate)
  const samples = new Int16Array(frames * 2)
  for (let i = 0; i < frames; i++) samples[i * 2] = samples[i * 2 + 1] = i < frames / 2 ? 8000 : 0
  return writeWav({
    format: { channels: 2, sampleRate: rate, bitsPerSample: 16 },
    data: new Uint8Array(samples.buffer),
  })
}

describe('createOpenEffects', () => {
  function fakeMusic(over: Partial<MusicGenerator> = {}) {
    const seen: MusicRequest[] = []
    const music: MusicGenerator = {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate(request) {
        seen.push(request)
        return { wav: tone(request.seconds) } satisfies GeneratedTake
      },
      close() {},
      ...over,
    }
    return { music, seen }
  }

  it('asks the Stable Audio worker for Short with the description as it is, and trims the take', async () => {
    const { music, seen } = fakeMusic()
    const take = await createOpenEffects(music).generate({
      prompt: 'a door creak',
      seconds: 4,
      seed: 9,
    })
    expect(seen).toEqual([
      {
        model: 'short',
        brief: 'a door creak',
        kind: 'stinger',
        seconds: 4,
        bpm: null,
        key: null,
        seed: 9,
        plain: true,
      },
    ])
    // The tone is the first 2 s; the take ends just after it.
    expect(take.seed).toBe(9)
    const frames = readWav(take.wav).data.length / 4
    expect(frames).toBeGreaterThan(1990)
    expect(frames).toBeLessThan(2030)
  })

  it('passes the stop signal on and keeps the music’s worker open when closed', async () => {
    let signal: AbortSignal | undefined
    let closed = 0
    const { music } = fakeMusic({
      async generate(request, given) {
        signal = given
        return { wav: tone(request.seconds), seed: 77 }
      },
      close() {
        closed++
      },
    })
    const open = createOpenEffects(music)
    const stop = new AbortController()
    const take = await open.generate({ prompt: 'a', seconds: 1, seed: 1 }, stop.signal)
    expect(signal).toBe(stop.signal)
    expect(take.seed).toBe(77)
    await open.close()
    expect(closed).toBe(0)
  })

  it('is whole when Short is installed, absent otherwise, and ready as the worker says', async () => {
    expect(await createOpenEffects(fakeMusic().music).download()).toBe('whole')
    const missing = createOpenEffects(
      fakeMusic({
        installed: () => false,
        ready: () => ({ ok: false, message: 'Short is not on this computer.', fix: 'See Setup.' }),
      }).music,
    )
    expect(await missing.download()).toBe('absent')
    expect(await missing.ready()).toEqual({ ok: false, message: 'Short is not on this computer.' })
  })
})

describe('createEffectGenerator', () => {
  it('sends each request, readiness and download to its model’s generator', async () => {
    const calls: string[] = []
    const one = (name: string): ModelEffects => ({
      download: () => (calls.push(`${name} download`), 'whole'),
      ready: () => (calls.push(`${name} ready`), { ok: true }),
      generate: async (request) => (
        calls.push(`${name} ${request.prompt}`),
        { wav: new Uint8Array(), seed: request.seed }
      ),
      close: () => void calls.push(`${name} close`),
    })
    const generator = createEffectGenerator({ 'small-sfx': one('small'), 'open-1': one('open') })
    generator.download('open-1')
    generator.ready('small-sfx')
    await generator.generate({ model: 'open-1', prompt: 'x', seconds: 1, seed: 2 })
    await generator.close()
    expect(calls).toEqual(['open download', 'small ready', 'open x', 'small close', 'open close'])
  })
})
