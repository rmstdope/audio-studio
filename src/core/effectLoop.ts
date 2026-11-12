import { shapeLoop, wavSeconds } from './musicTake'
import type { Wav } from './wav'

/** The longest crossfade at a loop's seam, in seconds: effects are short, and ambience needs little. */
const EFFECT_SEAM_SECONDS = 1

/**
 * What the model is asked for beyond the loop and its seam, in seconds, and dropped: Small SFX
 * fades out in its last tenth of a second to under a second (§12, decision 9), and a faded tail
 * would dip at the seam.
 */
export const EFFECT_LOOP_SPARE_SECONDS = 1

/** A sound ending within this many seconds of the length counts as sounding all the way. */
const FULL_TOLERANCE_SECONDS = 0.01

/** A blend shorter than this is not worth making: the take is just cut. */
const MIN_BLEND_SECONDS = 0.02

/** The crossfade at the seam of a loop of `seconds`: a second, at most half of a short loop. */
export function effectSeamSeconds(seconds: number): number {
  return Math.min(EFFECT_SEAM_SECONDS, seconds / 2)
}

/** How long the model is asked to make a loop of `seconds`: the loop, its seam and a spare second. */
export function loopRequestSeconds(seconds: number): number {
  return seconds + effectSeamSeconds(seconds) + EFFECT_LOOP_SPARE_SECONDS
}

/** `wav` cut or padded with silence to exactly `seconds`. */
function fitted(wav: Wav, seconds: number): Wav {
  const { channels, sampleRate, bitsPerSample } = wav.format
  const bytes = Math.round(seconds * sampleRate) * channels * (bitsPerSample / 8)
  if (wav.data.length === bytes) return wav
  const data = new Uint8Array(bytes)
  data.set(wav.data.subarray(0, bytes))
  return { format: wav.format, data }
}

/**
 * A loop from a take made at `loopRequestSeconds` (its trailing silence trimmed), exactly `seconds`
 * long. A sound that ends before `seconds` is kept as it is, padded with silence, and says where
 * it goes quiet (`quietAt`): crossfading silence over the start would dip it. Otherwise the take is
 * cut where its sound ends, at most the seam after `seconds`, and that stretch crossfaded over the
 * start, as a music loop's.
 */
export function shapeEffectLoop(wav: Wav, seconds: number): { wav: Wav; quietAt: number | null } {
  const sounded = wavSeconds(wav)
  if (sounded < seconds - FULL_TOLERANCE_SECONDS) {
    return { wav: fitted(wav, seconds), quietAt: Math.round(sounded * 1000) / 1000 }
  }
  // Only the sound there is is blended: silence over the start would dip it.
  const blend = Math.min(effectSeamSeconds(seconds), sounded - seconds)
  if (blend < MIN_BLEND_SECONDS) return { wav: fitted(wav, seconds), quietAt: null }
  return { wav: shapeLoop(fitted(wav, seconds + blend), seconds, blend), quietAt: null }
}
