import {
  defaultTakeModel,
  IMAGE_MODEL_IDS,
  type ImageModelId,
  type ImageModelState,
} from './imageModels'
import type { ImageMakingSummary } from './imageTakes'
import type { ImageStatus } from './images'
import type { Figures } from './takeTimes'

/** How many takes one press of Make asks for on each image. */
export const TAKES_EACH = 4

/** An image as the press needs it. */
export interface MakeAllImage {
  id: string
  title: string
  status: ImageStatus
}

/** Why the takes are not made on Setup's image model. */
export type OtherModelReason = 'absent' | 'partial' | 'failed'

/** What one press would do, and what it leaves out. */
export type ImagesMakeAllPlan =
  /** Images cannot be made yet: the generator is not ready, or neither model is on this computer. */
  | { kind: 'not-ready' }
  /** Which images have a chosen take is not known: the lock cannot be read, so nothing is offered. */
  | { kind: 'lock-unread' }
  /** No image can be started: each has a chosen take, or is left out for another reason. */
  | { kind: 'all-chosen' }
  | {
      kind: 'ready'
      /** The images that get takes. */
      images: MakeAllImage[]
      /** Left out: they have a chosen take (an out-of-date one counts). */
      chosen: MakeAllImage[]
      /** Left out: already making takes. */
      busy: { id: string; title: string }[]
      /** Left out: the game's lists disagree about them. */
      disagree: { id: string; title: string }[]
      /** How many takes in all. */
      takes: number
      /** The model the takes are made with. */
      model: ImageModelId
      /** Why that is not Setup's model; null when it is. */
      why: OtherModelReason | null
      /** About how long they take, one after another, in seconds. */
      seconds: number
      /** Whether the figure behind `seconds` is still only a guess. */
      guess: boolean
    }

/**
 * What one press on an act's Make would do: four takes for every image with no chosen take
 * (whether or not it has other takes) that is not already making takes, on Setup's `main` model, or
 * on the other one when `main` is not whole or failed its last take (as an image's own page does).
 * `conflicts` are the images the game's lists disagree about; `ready` says the generator can run.
 */
export function planImagesMakeAll({
  rows,
  conflicts,
  making,
  main,
  states,
  ready,
  figures,
}: {
  rows: readonly MakeAllImage[]
  conflicts: readonly { id: string; title: string }[]
  making: Readonly<Record<string, ImageMakingSummary>>
  main: ImageModelId
  states: Readonly<Record<ImageModelId, ImageModelState>>
  ready: boolean
  figures: Figures
}): ImagesMakeAllPlan {
  if (rows.some((r) => r.status === 'unknown')) return { kind: 'lock-unread' }
  const lacking = rows.filter((r) => r.status === 'none yet')
  const busy = lacking.filter((r) => (making[r.id]?.takes ?? 0) > 0)
  const images = lacking.filter((r) => !busy.includes(r))
  if (!images.length) return { kind: 'all-chosen' }
  if (!ready || !IMAGE_MODEL_IDS.some((id) => states[id].download === 'whole')) {
    return { kind: 'not-ready' }
  }
  const model = defaultTakeModel(main, states)
  const state = states[main]
  const why: OtherModelReason | null =
    model === main
      ? null
      : state.download === 'absent'
        ? 'absent'
        : state.download === 'partial'
          ? 'partial'
          : 'failed'
  const takes = images.length * TAKES_EACH
  return {
    kind: 'ready',
    images,
    chosen: rows.filter((r) => r.status !== 'none yet'),
    busy,
    disagree: [...conflicts],
    takes,
    model,
    why,
    seconds: takes * figures[model].seconds,
    guess: figures[model].guess,
  }
}
