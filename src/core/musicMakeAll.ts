import type { TrackStatus } from './musicChoose'
import type { MusicMakingSummary } from './musicTake'
import { canMake, musicModel, takePrice, type MusicModelId } from './musicModels'

/** How many takes one press of Make takes asks for on each track. */
export const TAKES_EACH = 4

/** A track as the press needs it. */
export interface MakeAllTrack {
  id: string
  title: string
  seconds: number
  status: TrackStatus
}

/** What one press would do, and what it leaves out. */
export type MakeAllPlan =
  /** Music cannot be made yet: nothing installed, or the generator is not ready. */
  | { kind: 'not-ready' }
  /** No track lacks a chosen take. */
  | { kind: 'all-chosen' }
  /** Tracks lack a chosen take, but the model can make none of them at their length. */
  | { kind: 'none-possible'; model: MusicModelId; count: number }
  | {
      kind: 'ready'
      /** The tracks that get takes. */
      tracks: MakeAllTrack[]
      /** Left out: they have a chosen take. */
      chosen: MakeAllTrack[]
      /** Left out: longer than the model can make. */
      tooLong: MakeAllTrack[]
      /** Left out: already making takes. */
      busy: MakeAllTrack[]
      /** How many takes in all. */
      takes: number
      /** What they cost in US dollars with a paid model; null when free. */
      price: number | null
      /** About how long they take, one after another, in seconds. */
      seconds: number
    }

/**
 * What one press on a list's Make takes would do: four takes for every track with no chosen take
 * (whether or not it has other takes) that is not already making takes and that the project's
 * `model` can make at its length. A track whose chosen take has changed or is missing has a chosen
 * take; one whose lock cannot be read is neither counted nor named. `ready` says whether music can
 * be made at all.
 */
export function planMakeAll({
  kind,
  tracks,
  making,
  model,
  ready,
}: {
  kind: 'loop' | 'stinger'
  tracks: readonly MakeAllTrack[]
  making: Readonly<Record<string, MusicMakingSummary>>
  model: MusicModelId
  ready: boolean
}): MakeAllPlan {
  const lacking = tracks.filter((t) => t.status === 'not-chosen')
  const chosen = tracks.filter((t) => t.status !== 'not-chosen' && t.status !== 'unknown')
  if (!lacking.length && !tracks.some((t) => t.status === 'unknown')) return { kind: 'all-chosen' }
  if (!ready) return { kind: 'not-ready' }
  const busy = lacking.filter((t) => (making[t.id]?.takes ?? 0) > 0)
  const idle = lacking.filter((t) => !busy.includes(t))
  const tooLong = idle.filter((t) => !canMake(model, kind, t.seconds))
  const planned = idle.filter((t) => !tooLong.includes(t))
  if (!planned.length && tooLong.length) {
    return { kind: 'none-possible', model, count: tooLong.length }
  }
  const cents = (track: MakeAllTrack) => {
    const price = takePrice(model, { kind, seconds: track.seconds })
    return price === null ? null : Math.round(price * 100) / 100
  }
  const prices = planned.map(cents)
  return {
    kind: 'ready',
    tracks: planned,
    chosen,
    tooLong,
    busy,
    takes: planned.length * TAKES_EACH,
    price: prices.some((p) => p === null)
      ? null
      : prices.reduce<number>((a, p) => a + p! * TAKES_EACH, 0),
    seconds: planned.length * TAKES_EACH * musicModel(model).seconds,
  }
}
