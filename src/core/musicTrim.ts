import { z } from 'zod'
import type { Wav } from './wav'

/** Samples at or below this (of 32768) count as near-silence: the level a stinger's last sound is found by. */
export const NEAR_SILENT = 300

/** What is kept of the near-silence at each cut, so the sound is not clipped, in seconds. */
export const KEEP_SECONDS = 0.05

/** A side with less than this to cut is left alone, in seconds. */
export const MIN_CUT_SECONDS = 0.05

/** What is kept of the near-silence at each cut, and the least a side must have to cut to be cut, in seconds. */
export interface TrimRules {
  keep: number
  minCut: number
}

/** A stinger's rules. */
export const STINGER_TRIM_RULES: TrimRules = { keep: KEEP_SECONDS, minCut: MIN_CUT_SECONDS }

/** How much of a take is cut away, in seconds from each end. */
export const TrimSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
})

/** How much of a take is cut away from each end. */
export type Trim = z.infer<typeof TrimSchema>

/** What there is to cut from a take: a trim, nothing, or no sound at all. */
export type TrimFinding = ({ kind: 'cut' } & Trim) | { kind: 'nothing' } | { kind: 'silent' }

/** The first and last frame (inclusive) above `NEAR_SILENT`, or null when there is none. */
function soundSpan(wav: Wav): { first: number; last: number; frames: number } | null {
  if (wav.format.bitsPerSample !== 16) throw new Error('only 16-bit audio can be trimmed')
  const { channels } = wav.format
  const view = new DataView(wav.data.buffer, wav.data.byteOffset, wav.data.byteLength)
  const frames = Math.floor(wav.data.length / (2 * channels))
  const loud = (frame: number) => {
    for (let c = 0; c < channels; c++) {
      if (Math.abs(view.getInt16((frame * channels + c) * 2, true)) > NEAR_SILENT) return true
    }
    return false
  }
  let first = 0
  while (first < frames && !loud(first)) first++
  if (first === frames) return null
  let last = frames - 1
  while (last > first && !loud(last)) last--
  return { first, last, frames }
}

/**
 * What to cut from a take: the near-silent start and end, each leaving `rules.keep` of
 * lead-in. A side with under `rules.minCut` to cut is left alone; with both left alone there is
 * nothing to cut; with no sound above `NEAR_SILENT` there is none to keep.
 */
export function findTrim(wav: Wav, rules: TrimRules = STINGER_TRIM_RULES): TrimFinding {
  const span = soundSpan(wav)
  if (!span) return { kind: 'silent' }
  const { sampleRate } = wav.format
  const side = (frames: number) => {
    const seconds = frames / sampleRate - rules.keep
    return seconds >= rules.minCut ? seconds : 0
  }
  const start = side(span.first)
  const end = side(span.frames - 1 - span.last)
  return start || end ? { kind: 'cut', start, end } : { kind: 'nothing' }
}

/** The part of a WAV between the cuts. */
export function trimWav(wav: Wav, trim: Trim): Wav {
  const { channels, sampleRate, bitsPerSample } = wav.format
  const frameBytes = (bitsPerSample / 8) * channels
  const frames = Math.floor(wav.data.length / frameBytes)
  const from = Math.min(frames, Math.round(trim.start * sampleRate))
  const to = Math.max(from, frames - Math.round(trim.end * sampleRate))
  return { format: wav.format, data: wav.data.subarray(from * frameBytes, to * frameBytes) }
}

/** A take's length once trimmed, in seconds. */
export function trimmedSeconds(seconds: number, trim: Trim): number {
  return Math.max(0, seconds - trim.start - trim.end)
}

/** The line on a trimmed take: how much went from each end, to one decimal. */
export function cutLine(trim: Trim): string {
  return `${trim.start.toFixed(1)} s cut from the start, ${trim.end.toFixed(1)} s from the end`
}

/** Why Trim silence is greyed out on a take that starts and ends on its sound. */
export const NOTHING_LINE = 'Starts and ends on its sound: nothing to cut.'

/** Why Trim silence is greyed out on a take with no sound in it. */
export const SILENT_LINE = 'Near-silent throughout: there is no sound to keep.'

/** The red line when Trim silence or Undo trim failed, naming the take and what the game plays. */
export function trimFailure(
  n: number,
  reason: string,
  how: { inGame: boolean; undo: boolean },
): string {
  const plain = reason.replace(/\.$/, '')
  const said = plain.charAt(0).toLowerCase() + plain.slice(1)
  const word = how.undo ? 'untrimmed' : 'trimmed'
  const after = !how.inGame
    ? 'The take is as it was.'
    : how.undo
      ? 'The game still plays it trimmed.'
      : 'The game still plays it as it was.'
  return `Take ${n} could not be ${word}: ${said}. ${after}`
}

/** A length as m:ss.s (`5.84` → `0:05.8`), for a trimmed take, whose cut is finer than a second. */
export function preciseClock(seconds: number): string {
  const tenths = Math.round(seconds * 10)
  const whole = Math.floor(tenths / 10)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`
}
