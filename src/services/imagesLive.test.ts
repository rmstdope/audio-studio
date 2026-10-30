import { describe, expect, it } from 'bun:test'
import { IMAGE_MODEL_IDS } from '../core/imageModels'
import { createMfluxGenerator, mfluxReady } from './images'

// Live: makes one 512×288 take with each model through the real mflux, which downloads the weights
// the first time (15 GB and 31 GB). Opt in with AUDIO_STUDIO_LIVE_IMAGES=1, on a Mac with mflux.
const machine = {
  which: (c: string) => Bun.which(c) !== null,
  platform: process.platform,
  arch: process.arch,
}
const live = process.env.AUDIO_STUDIO_LIVE_IMAGES === '1' && mfluxReady(machine).ok

describe.skipIf(!live)('createMfluxGenerator, with real mflux (macOS)', () => {
  for (const model of IMAGE_MODEL_IDS) {
    it(
      `makes a PNG of the size asked with ${model}`,
      async () => {
        const take = await createMfluxGenerator().generate({
          prompt: 'a stone cellar lit by one candle, gouache',
          width: 512,
          height: 288,
          seed: 7,
          model,
        })
        const view = new DataView(take.png.buffer, take.png.byteOffset)
        expect([...take.png.slice(1, 4)]).toEqual([80, 78, 71])
        expect([view.getUint32(16), view.getUint32(20)]).toEqual([512, 288])
      },
      30 * 60_000,
    )
  }
})
