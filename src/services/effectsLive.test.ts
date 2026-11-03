import { describe, expect, it } from 'bun:test'
import { readWav } from '../core/wav'
import { createEffectsWorker } from './effects'

// Live: makes one effect with the real Stable Audio 3 Small SFX on the CPU (about 25 s the first
// time). Opt in with AUDIO_STUDIO_LIVE_EFFECTS=1, with uv and the model downloaded (see Setup's
// Sound-effect models row).
const probe = createEffectsWorker()
const live =
  process.env.AUDIO_STUDIO_LIVE_EFFECTS === '1' &&
  Bun.which('uv') !== null &&
  probe.download() === 'whole'

describe.skipIf(!live)('createEffectsWorker, with real Small SFX', () => {
  it(
    'makes a stereo take no longer than asked, with its silence trimmed',
    async () => {
      const worker = createEffectsWorker({ timeoutMs: 20 * 60_000 })
      try {
        const take = await worker.generate({ prompt: 'a short pickup chime', seconds: 2, seed: 3 })
        const wav = readWav(take.wav)
        expect(wav.format).toMatchObject({ channels: 2, sampleRate: 44100, bitsPerSample: 16 })
        const seconds = wav.data.length / (4 * 44100)
        expect(seconds).toBeGreaterThan(0.1)
        expect(seconds).toBeLessThanOrEqual(2)
      } finally {
        await worker.close()
      }
    },
    20 * 60_000,
  )
})
