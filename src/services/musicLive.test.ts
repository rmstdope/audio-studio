import { describe, expect, it } from 'bun:test'
import { wavSeconds } from '../core/musicTake'
import { readWav } from '../core/wav'
import { aceStepCheckpoints, aceStepReady, createAceStepWorker } from './music'

// Live: makes one 10-second stinger with the real ACE-Step (XL turbo, 4B language model), which takes
// minutes the first time. Opt in with AUDIO_STUDIO_LIVE_MUSIC=1, on a Mac with uv and the models
// (see Setup's Music generator row).
const machine = {
  which: (c: string) => Bun.which(c) !== null,
  platform: process.platform,
  arch: process.arch,
}
const live =
  process.env.AUDIO_STUDIO_LIVE_MUSIC === '1' && aceStepReady(machine, aceStepCheckpoints()).ok

describe.skipIf(!live)('createAceStepWorker, with real ACE-Step (macOS)', () => {
  it(
    'makes a short take, as long as asked',
    async () => {
      const worker = createAceStepWorker()
      try {
        const take = await worker.generate({
          brief: 'short triumphant brass fanfare',
          kind: 'stinger',
          seconds: 10,
          bpm: null,
          key: null,
          seed: 7,
        })
        expect(take.seed).toBe(7)
        expect(wavSeconds(readWav(take.wav))).toBeGreaterThan(9)
      } finally {
        worker.close()
      }
    },
    30 * 60_000,
  )
})
