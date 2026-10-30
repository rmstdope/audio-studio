import { writeWav } from '../core/wav'
import type { MusicGenerator } from './music'

/**
 * A stand-in generator for working on the studio's own pages (`CONTENT_STUDIO_FAKE_MUSIC=1`): a
 * tone as long as asked after a few seconds, a failure for a brief that says "fail", and not
 * ready for one that says "unready". It makes no music.
 */
export function createFakeMusic(delayMs = 4000): MusicGenerator {
  return {
    ready: () => ({ ok: true }),
    installed: () => true,
    async generate(request) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (request.brief.includes('fail')) throw new Error('The music generator: out of memory')
      const rate = 8000
      const samples = new Int16Array(Math.round(request.seconds * rate))
      samples.forEach((_, i) => {
        const swell = 0.4 + 0.6 * Math.abs(Math.sin(i / rate / 3))
        samples[i] = Math.round(
          6000 * swell * Math.sin((i / rate) * 2 * Math.PI * (220 + (request.seed % 5) * 55)),
        )
      })
      const format = { channels: 1, sampleRate: rate, bitsPerSample: 16 }
      return { wav: writeWav({ format, data: new Uint8Array(samples.buffer) }), seed: request.seed }
    },
    close() {},
  }
}
