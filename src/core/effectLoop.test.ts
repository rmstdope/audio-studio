import { describe, expect, it } from 'bun:test'
import {
  EFFECT_LOOP_SPARE_SECONDS,
  effectSeamSeconds,
  loopRequestSeconds,
  shapeEffectLoop,
} from './effectLoop'
import { wavSeconds } from './musicTake'
import type { Wav } from './wav'

const RATE = 100

/** A mono 16-bit WAV at 100 Hz of `seconds`, sample i being `at(i / RATE)`. */
function make(seconds: number, at: (t: number) => number): Wav {
  const samples = new Int16Array(Math.round(seconds * RATE))
  samples.forEach((_, i) => (samples[i] = Math.round(at(i / RATE))))
  return {
    format: { channels: 1, sampleRate: RATE, bitsPerSample: 16 },
    data: new Uint8Array(samples.buffer),
  }
}

const samplesOf = (wav: Wav) =>
  new Int16Array(wav.data.buffer.slice(wav.data.byteOffset, wav.data.byteOffset + wav.data.length))

describe('the seam and what the model is asked for', () => {
  it('crossfades one second, and at most half of a short loop', () => {
    expect(effectSeamSeconds(10)).toBe(1)
    expect(effectSeamSeconds(1.5)).toBe(0.75)
  })

  it('asks the model for the length, the seam and a spare second', () => {
    expect(loopRequestSeconds(10)).toBe(10 + 1 + EFFECT_LOOP_SPARE_SECONDS)
    expect(loopRequestSeconds(1.5)).toBe(1.5 + 0.75 + EFFECT_LOOP_SPARE_SECONDS)
  })
})

describe('shapeEffectLoop', () => {
  it('cuts a take that sounds all the way at the length and crossfades its end into its start', () => {
    const source = make(12, () => 1000)
    const { wav, quietAt } = shapeEffectLoop(source, 10)
    expect(quietAt).toBeNull()
    expect(wavSeconds(wav)).toBe(10)
    const out = samplesOf(wav)
    // Constant level through the blend: equal power of two equal signals peaks at 1.41x.
    expect(out[0]).toBeGreaterThan(900)
    expect(out[out.length - 1]).toBe(1000)
  })

  it('pads a take that stops before the length with silence, and says where it goes quiet', () => {
    const source = make(6.2, () => 1000)
    const { wav, quietAt } = shapeEffectLoop(source, 10)
    expect(quietAt).toBe(6.2)
    expect(wavSeconds(wav)).toBe(10)
    const out = samplesOf(wav)
    // No crossfade: the start is not dipped, the end is silent.
    expect(out[0]).toBe(1000)
    expect(out[out.length - 1]).toBe(0)
    expect(out[620]).toBe(0)
    expect(out[619]).toBe(1000)
  })

  it('crossfades only the sound there is when it ends between the length and the end of the seam', () => {
    const { wav, quietAt } = shapeEffectLoop(
      make(10.5, () => 1000),
      10,
    )
    expect(quietAt).toBeNull()
    expect(wavSeconds(wav)).toBe(10)
    // Blending silence over the start would dip it: with sound on both sides the blend never drops below the level.
    expect(Math.min(...samplesOf(wav))).toBeGreaterThanOrEqual(995)
  })

  it('only cuts a take whose sound ends a moment past the length', () => {
    const { wav, quietAt } = shapeEffectLoop(
      make(10.01, () => 1000),
      10,
    )
    expect(quietAt).toBeNull()
    expect(wavSeconds(wav)).toBe(10)
    expect(Math.min(...samplesOf(wav))).toBe(1000)
  })

  it('shapes a short loop with a shortened seam', () => {
    const { wav, quietAt } = shapeEffectLoop(
      make(3, () => 500),
      1.5,
    )
    expect(quietAt).toBeNull()
    expect(wavSeconds(wav)).toBe(1.5)
  })

  it('does not go quiet for a sound that ends within a hundredth of the length', () => {
    expect(
      shapeEffectLoop(
        make(9.995, () => 1000),
        10,
      ).quietAt,
    ).toBeNull()
  })
})
