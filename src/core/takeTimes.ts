import { z } from 'zod'

/**
 * What image takes are timed for: each model apart, and FLUX.2 klein's patches apart from its
 * takes, since they do different work and can read differently.
 */
export const TIME_KEYS = [
  'klein',
  'z-image-turbo',
  'qwen-image',
  'qwen-edit',
  'klein-edit',
] as const

/** One of the things image takes are timed for. */
export type TimeKey = (typeof TIME_KEYS)[number]

/** What a take is said to take before this computer has timed one: a guess, in seconds. */
export const STARTING_SECONDS: Record<TimeKey, number> = {
  klein: 20,
  'z-image-turbo': 60,
  'qwen-image': 180,
  'qwen-edit': 480,
  'klein-edit': 20,
}

/** How many of a model's last finished takes its figure is the middle of. */
export const TIMED_TAKES = 5

/**
 * The file of the seconds of the last finished takes on this computer, for each thing timed
 * (oldest first). A value that is not a number is read, and dropped by `cleanTimes`.
 */
export const TakeTimesSchema = z.partialRecord(z.enum(TIME_KEYS), z.array(z.unknown()))

/** The saved timings. */
export type TakeTimes = Partial<Record<TimeKey, number[]>>

/** A figure: the seconds a take is said to take, and whether it is still only a guess. */
export interface Figure {
  seconds: number
  guess: boolean
}

/** The figures of every thing timed, as the pages read them. */
export type Figures = Record<TimeKey, Figure>

/** The timings with one more finished take; a time that is not a positive number is ignored. */
export function recordTime(times: TakeTimes, key: TimeKey, seconds: number): TakeTimes {
  if (!Number.isFinite(seconds) || seconds <= 0) return times
  const rounded = Math.round(seconds * 10) / 10
  return cleanTimes({ ...times, [key]: [...(times[key] ?? []), rounded] })
}

/** The middle (median) of the last five finished takes, or the starting guess when there are none. */
export function figureOf(times: TakeTimes, key: TimeKey): Figure {
  const taken = times[key] ?? []
  if (taken.length === 0) return { seconds: STARTING_SECONDS[key], guess: true }
  const sorted = [...taken].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const seconds = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return { seconds, guess: false }
}

/** Every thing timed with its figure. */
export function figuresOf(times: TakeTimes): Figures {
  return Object.fromEntries(TIME_KEYS.map((k) => [k, figureOf(times, k)])) as Figures
}

/**
 * A time as the pages round it: under a minute to five seconds (at least 5), a minute and over to
 * whole minutes. A menu rounds to the nearest; a time left rounds up.
 */
export function roundedSeconds(seconds: number, how: 'nearest' | 'up'): number {
  const round = how === 'up' ? Math.ceil : Math.round
  const fives = Math.max(5, round(seconds / 5) * 5)
  if (fives < 60) return fives
  return Math.max(60, round(seconds / 60) * 60)
}

/** A time as a person reads it: "25 s", "1 min", "14 min" (never hours). */
export function timeText(seconds: number, how: 'nearest' | 'up'): string {
  const s = roundedSeconds(seconds, how)
  return s < 60 ? `${s} s` : `${s / 60} min`
}

/** What a menu says a take takes: "a guess: about 20 s a take", or "about 25 s a take". */
export function perTakeText(figure: Figure): string {
  return `${figure.guess ? 'a guess: ' : ''}about ${timeText(figure.seconds, 'nearest')} a take`
}

/**
 * The saved timings as read: only positive numbers, only the last five of each, the keys in a
 * fixed order.
 */
export function cleanTimes(file: z.infer<typeof TakeTimesSchema>): TakeTimes {
  const clean: TakeTimes = {}
  for (const key of TIME_KEYS) {
    const taken = (file[key] ?? []).filter(
      (s): s is number => typeof s === 'number' && Number.isFinite(s) && s > 0,
    )
    if (taken.length) clean[key] = taken.slice(-TIMED_TAKES)
  }
  return clean
}

/** What an edit model's patch takes are timed as: klein's patches apart from klein's takes. */
export function timeKeyOfEdit(model: 'qwen-edit' | 'klein'): TimeKey {
  return model === 'klein' ? 'klein-edit' : 'qwen-edit'
}
