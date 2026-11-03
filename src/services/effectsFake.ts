import { writeWav } from '../core/wav'
import type { EffectGenerator } from './effects'

/**
 * A stand-in generator for working on the studio's own pages (`CONTENT_STUDIO_FAKE_EFFECTS=1`): a
 * short tone, shorter than the length asked as the real model's effects are, after about two
 * seconds, and a failure for a description that says "fail". A loop's tone fills the length asked,
 * unless the description says "quiet", which stops it at 60% of it. It makes no sound effects.
 */
export function createFakeEffects(delayMs = 2000): EffectGenerator {
  return {
    download: () => 'whole',
    ready: () => ({ ok: true }),
    async generate(request, signal) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('The effects generator was stopped.'))
        })
      })
      if (request.prompt.includes('fail'))
        throw new Error('The effects generator ran out of memory')
      const rate = 8000
      const seconds = request.loops
        ? request.seconds * (request.prompt.includes('quiet') ? 0.6 : 1)
        : Math.min(request.seconds, 0.4 + (request.seed % 7) * 0.2)
      const samples = new Int16Array(Math.round(seconds * rate))
      samples.forEach((_, i) => {
        const fade = 1 - i / samples.length
        samples[i] = Math.round(
          7000 * fade * Math.sin((i / rate) * 2 * Math.PI * (300 + (request.seed % 5) * 120)),
        )
      })
      const format = { channels: 1, sampleRate: rate, bitsPerSample: 16 }
      return { wav: writeWav({ format, data: new Uint8Array(samples.buffer) }), seed: request.seed }
    },
    async close() {},
  }
}
