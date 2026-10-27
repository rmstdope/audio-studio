import { describe, expect, it } from 'bun:test'
import { wavSeconds } from '../core/musicTake'
import { readWav } from '../core/wav'
import { aceStepCheckpoints, aceStepReady, createAceStepWorker } from './music'
import { STABLE_AUDIO_DIR, createStableAudioWorker, stableAudioReady } from './stableAudio'
import { createElevenMusic } from './elevenMusic'

// Live: makes one 10-second stinger with the real ACE-Step (XL turbo, 4B language model), and one
// with each Stable Audio model that is downloaded, which takes minutes the first time. Opt in with
// AUDIO_STUDIO_LIVE_MUSIC=1, on a Mac with uv and the models (see Setup's Music generator row).
const machine = {
  which: (c: string) => Bun.which(c) !== null,
  platform: process.platform,
  arch: process.arch,
}
const optedIn = process.env.AUDIO_STUDIO_LIVE_MUSIC === '1'
const live = optedIn && aceStepReady(machine, aceStepCheckpoints()).ok

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
          model: 'balanced',
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

// Each Stable Audio model whose folder is in ~/.cache/stable-audio: a fresh install of the worker's
// libraries once failed before the first take, which only the real libraries show.
for (const model of ['short', 'shortest'] as const) {
  const ready = optedIn && stableAudioReady(machine, STABLE_AUDIO_DIR, model).ok
  describe.skipIf(!ready)(
    `createStableAudioWorker, with real Stable Audio (${model}, macOS)`,
    () => {
      it(
        'makes a short take, as long as asked',
        async () => {
          const worker = createStableAudioWorker()
          try {
            const take = await worker.generate({
              brief: 'short triumphant brass fanfare',
              kind: 'stinger',
              seconds: 10,
              bpm: null,
              key: null,
              seed: 7,
              model,
            })
            expect(take.seed).toBe(7)
            expect(wavSeconds(readWav(take.wav))).toBeGreaterThan(9)
          } finally {
            worker.close()
          }
        },
        30 * 60_000,
      )
    },
  )
}

// Live, and paid: makes one 10-second stinger with Eleven Music. Opt in with
// AUDIO_STUDIO_LIVE_ELEVENLABS=1 and ELEVENLABS_API_KEY in the environment, on a paid plan.
const elevenKey = process.env.ELEVENLABS_API_KEY ?? null
const liveEleven = process.env.AUDIO_STUDIO_LIVE_ELEVENLABS === '1' && elevenKey !== null
describe.skipIf(!liveEleven)('createElevenMusic, with real ElevenLabs', () => {
  it(
    'makes a short take, as long as asked, with no seed',
    async () => {
      const take = await createElevenMusic({ apiKey: async () => elevenKey }).generate({
        brief: 'short triumphant brass fanfare',
        kind: 'stinger',
        seconds: 10,
        bpm: null,
        key: null,
        seed: 7,
        model: 'eleven',
      })
      expect(take.seed).toBeUndefined()
      expect(wavSeconds(readWav(take.wav))).toBeGreaterThan(9)
    },
    10 * 60_000,
  )
})
