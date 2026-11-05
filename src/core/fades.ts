import { z } from 'zod'
import type { Wav } from './wav'

/** The two shapes a fade can have: a curve that sounds even to the ear, or an even change in volume. */
export const FADE_SHAPES = ['smooth', 'straight'] as const

/** The fades of a stinger take: how long it fades in and out (0 is no fade) and the shape of both. */
export const FadesSchema = z.object({
  in: z.number().finite().min(0),
  out: z.number().finite().min(0),
  shape: z.enum(FADE_SHAPES),
})

/** The fades of a stinger take. */
export type Fades = z.infer<typeof FadesSchema>

/** The step of the length boxes and handles, in seconds. */
export const FADE_STEP = 0.05

/** The big step of a handle (Shift with an arrow), in seconds. */
export const FADE_BIG_STEP = 0.5

/** Whether a take has any fade at all. */
export function hasFades(fades: Fades): boolean {
  return fades.in > 0 || fades.out > 0
}

/** Rounds a length to hundredths of a second, so sums of steps do not drift. */
function hundredths(seconds: number): number {
  return Math.round(seconds * 100) / 100
}

/** A length in seconds as it is read: "0.3", "1.5", "1". */
function lengthText(seconds: number): string {
  return `${hundredths(seconds)}`
}

/** What is said when a box is empty or negative. */
export const EMPTY_LINE = 'Type a length of 0 s or more.'

/** What is said when the fades together are longer than the take. */
export function tooLongLine(seconds: number): string {
  return `The fades together can't be longer than the take (${seconds.toFixed(1)} s).`
}

/** Why fades cannot be used on a take of `seconds`, or null when they can. */
export function fadesProblem(fades: Fades, seconds: number): string | null {
  if (!Number.isFinite(fades.in) || !Number.isFinite(fades.out) || fades.in < 0 || fades.out < 0) {
    return EMPTY_LINE
  }
  // A hundredth of slack, so lengths typed to the take's rounded length are not refused.
  return fades.in + fades.out > seconds + 0.005 ? tooLongLine(seconds) : null
}

/** The line under a take with fades: both, only one, and the shape. */
export function fadesLine(fades: Fades): string {
  const parts =
    fades.in > 0 && fades.out > 0
      ? `Fades in ${lengthText(fades.in)} s · out ${lengthText(fades.out)} s`
      : fades.in > 0
        ? `Fade in ${lengthText(fades.in)} s`
        : `Fade out ${lengthText(fades.out)} s`
  return `${parts} · ${fades.shape}`
}

/** The volume, 0 to 1, a fade of the shape has `progress` (0 to 1) of the way in. */
function curve(shape: Fades['shape'], progress: number): number {
  const x = Math.min(1, Math.max(0, progress))
  return shape === 'smooth' ? Math.sin((x * Math.PI) / 2) ** 2 : x
}

/** The volume, 0 to 1, a take of `seconds` has at `at` seconds with these fades. */
export function fadeGain(fades: Fades, seconds: number, at: number): number {
  const rising = fades.in > 0 && at < fades.in ? curve(fades.shape, at / fades.in) : 1
  const left = seconds - at
  const falling = fades.out > 0 && left < fades.out ? curve(fades.shape, left / fades.out) : 1
  return rising * falling
}

/**
 * A take with its fades in the sound itself: the first `in` seconds rise from silence and the
 * last `out` seconds fall to it, on every channel, as the game will play it.
 */
export function applyFades(wav: Wav, fades: Fades): Wav {
  if (!hasFades(fades)) return wav
  if (wav.format.bitsPerSample !== 16) throw new Error('only 16-bit audio can be faded')
  const { channels, sampleRate } = wav.format
  const { data } = wav
  const samples = new Int16Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.length - (data.length % 2)),
  )
  const frames = samples.length / channels
  const rise = Math.round(fades.in * sampleRate)
  const fall = Math.round(fades.out * sampleRate)
  for (let frame = 0; frame < frames; frame++) {
    const rising = rise > 0 && frame < rise ? curve(fades.shape, frame / rise) : 1
    const falling =
      fall > 0 && frames - 1 - frame < fall ? curve(fades.shape, (frames - 1 - frame) / fall) : 1
    const gain = rising * falling
    if (gain === 1) continue
    for (let channel = 0; channel < channels; channel++) {
      const at = frame * channels + channel
      samples[at] = Math.round(samples[at]! * gain)
    }
  }
  return {
    format: wav.format,
    data: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
  }
}

/** A handle's length after an arrow key: 0.05 s, or 0.5 s with Shift, kept between `min` and `max`. */
export function stepHandle(
  length: number,
  direction: 1 | -1,
  shift: boolean,
  min: number,
  max: number,
): number {
  const next = hundredths(length + direction * (shift ? FADE_BIG_STEP : FADE_STEP))
  return Math.min(max, Math.max(min, next))
}

/** The length a handle dragged to `x` pixels of a `width`-pixel waveform means, on the 0.05 s grid. */
export function lengthAtX(x: number, width: number, seconds: number): number {
  if (width <= 0) return 0
  const raw = (x / width) * seconds
  const snapped = hundredths(Math.round(raw / FADE_STEP) * FADE_STEP)
  return Math.min(seconds, Math.max(0, snapped))
}
