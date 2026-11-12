import { z } from 'zod'
import { EDIT_MODEL_IDS, type EditModelId, type ImageDownload } from './imageModels'
import { PatchAreaSchema, type PatchArea } from './imagePatches'
import type { ImageTakeView } from './imageTakes'

/** How many characters of the words the take's caption keeps. */
const CAPTION_WORDS = 60

/**
 * One fine-tune on an image's board: a picture beside the board, as big as the picture it was made
 * from. It belongs to that picture, `base`: a take's number, or 0 for the game's own image.
 */
export const FineTuneSchema = z.strictObject({
  /** Per image, never reused. */
  n: z.number().int().positive(),
  base: z.number().int().nonnegative(),
  seed: z.number().int(),
  /** The words it was made from. */
  words: z.string(),
  /** The marked area it was made with; null when the whole picture could change. */
  area: PatchAreaSchema.nullable(),
  /** It has been laid over the picture once; one that has not shows "new". */
  seen: z.boolean().default(false),
  model: z.enum(EDIT_MODEL_IDS),
})

/** A fine-tune on a board. */
export type FineTune = z.infer<typeof FineTuneSchema>

/** An image's fine-tunes, `content-studio/cache/image-fine-tunes/<image>/board.json`. */
export const FineTuneBoardSchema = z.strictObject({
  next: z.number().int().positive().default(1),
  tunes: z.array(FineTuneSchema).default([]),
})

/** An image's board of fine-tunes. */
export type FineTuneBoard = z.infer<typeof FineTuneBoardSchema>

/** The body of making fine-tunes: 1 to 10 of the words and mark, or the failed one again. */
export const MakeFineTunesBody = z.union([
  z.strictObject({
    count: z.number().int().min(1).max(10),
    words: z.string().refine((w) => w.trim() !== '', 'Say what to change.'),
    area: PatchAreaSchema.nullable(),
    /** The edit model for the new fine-tunes; the default one when left out. */
    model: z.enum(EDIT_MODEL_IDS).optional(),
  }),
  z.strictObject({ retry: z.number().int().positive() }),
])

/** The body of using a fine-tune. */
export const UseFineTuneBody = z.strictObject({ n: z.number().int().positive() })

/** The words as a caption shows them: on one line, shortened with an ellipsis. */
export function shortened(words: string): string {
  const one = words.replace(/\s+/g, ' ').trim()
  return one.length > CAPTION_WORDS ? `${one.slice(0, CAPTION_WORDS).trimEnd()}…` : one
}

/** Where a fine-tuned take says it came from; `from` is the take's number, null for the game's own image. */
export function fineTuneCaption(from: number | null, words: string): string {
  const source = from === null ? "the game's own image" : `Take ${from}`
  return `Fine-tuned from ${source}: “${shortened(words)}”`
}

/**
 * What the green line says after "Use this": the new take is in the game, and the named areas and
 * chosen patches that came along, naming only what exists. `from` is the take it was made from,
 * null for the game's own image.
 */
export function cameAlongLine(
  take: number,
  carried: { areas: number; patches: number },
  from: number | null,
): string {
  if (from === null) return `Take ${take} is in the game now, fine-tuned from the game's own image.`
  const parts = [
    carried.areas > 0 ? `${carried.areas} named area${carried.areas === 1 ? '' : 's'}` : null,
    carried.patches > 0
      ? `${carried.patches} chosen patch${carried.patches === 1 ? '' : 'es'}`
      : null,
  ].filter((p): p is string => p !== null)
  if (parts.length === 0) return `Take ${take} is in the game now.`
  return `Take ${take} is in the game now. Its ${parts.join(' and ')} came along from Take ${from}.`
}

/** A fine-tune as the page shows it. */
export interface FineTuneView {
  n: number
  words: string
  /** The marked area it was made with, in the picture's pixels; null when the whole picture could change. */
  area: PatchArea | null
  model: EditModelId
  /** Not yet laid over the picture. */
  isNew: boolean
}

/** A fine-tune waiting or being made. */
export interface FineTuneMakingView {
  n: number
  state: 'waiting' | 'making'
  /** Seconds since it started; 0 while it waits. */
  elapsed: number
  /** Seconds an edit is expected to take (a guess until timed). */
  expected: number
  model: EditModelId
}

/** A fine-tune that failed, kept until it is made again or dropped. */
export interface FineTuneFailedView {
  n: number
  message: string
  words: string
  area: PatchArea | null
  model: EditModelId
}

/** The picture in the game that fine-tunes are made from, in the pixels fine-tunes and marks use. */
export type FineTunePicture =
  | { kind: 'take'; n: number; width: number; height: number }
  | { kind: 'game'; width: number; height: number }
  | { kind: 'none' }

/** What the fine-tune panel of an image shows. */
export interface FineTunesView {
  ok: true
  picture: FineTunePicture
  /** Whether fine-tunes can be made on this computer, and why not if they cannot. */
  maker: { ok: true } | { ok: false; message: string }
  /** How much of each edit model's download is on this computer. */
  models: Record<EditModelId, ImageDownload>
  /** The fine-tunes of the picture, in order. */
  tunes: FineTuneView[]
  making: FineTuneMakingView[]
  failed: FineTuneFailedView[]
  /** The edit models whose last fine-tune or patch take failed. */
  failedModels: EditModelId[]
}

/** What using a fine-tune answered: the new take and what came along, or why not. */
export type UseFineTuneAnswer =
  | { ok: true; take: number; from: number | null; carried: { areas: number; patches: number } }
  | { ok: false; message: string }

/** One step of a picture's history: the game's own image, or a take. */
export type HistoryStep =
  | { kind: 'game' }
  | {
      kind: 'take'
      n: number
      /** The words it was fine-tuned with; null for a take made from the prompt. */
      words: string | null
      /** Made from the prompt, fine-tuned from the game's own image, or fine-tuned from a take. */
      from: 'prompt' | 'game' | 'take'
      /** The picture in the game. */
      inGame: boolean
      /** Comes after the one in the game: choosing it again redoes. */
      after: boolean
    }

/** The chain of the picture in the game, oldest first. */
export interface FineTuneHistory {
  steps: HistoryStep[]
  /** The index of the step in the game. */
  at: number
  /** The take Undo chooses; null when there is no step before. */
  undoTo: number | null
}

/**
 * The history of the picture in the game, read from the takes' "fine-tuned from": the chain from
 * the take made from the prompt (or from the game's own image) to the newest take that descends
 * from the chosen one. The steps after the chosen one are kept so they can be redone; a fine-tune
 * from an earlier step is the newest take, so the history follows its branch. A dropped take ends
 * the chain there. Nothing is stored.
 */
export function fineTuneHistory(
  takes: Pick<ImageTakeView, 'n' | 'fineTunedFrom'>[],
  chosen: number | null,
): FineTuneHistory {
  const byN = new Map(takes.map((t) => [t.n, t]))
  if (chosen === null || !byN.has(chosen)) return { steps: [{ kind: 'game' }], at: 0, undoTo: null }
  /** The takes from `n` back to the oldest still on the board, newest first. */
  const chainOf = (n: number): number[] => {
    const chain = [n]
    for (let t = byN.get(n); t?.fineTunedFrom?.take != null;) {
      t = byN.get(t.fineTunedFrom.take)
      if (!t || chain.includes(t.n)) break
      chain.push(t.n)
    }
    return chain
  }
  const tip = Math.max(...takes.map((t) => t.n).filter((n) => chainOf(n).includes(chosen)))
  const ns = chainOf(tip).reverse()
  const steps = ns.map((n): HistoryStep => {
    const from = byN.get(n)?.fineTunedFrom
    return {
      kind: 'take',
      n,
      words: from?.words ?? null,
      from: !from ? 'prompt' : from.take === null ? 'game' : 'take',
      inGame: n === chosen,
      after: ns.indexOf(n) > ns.indexOf(chosen),
    }
  })
  const at = ns.indexOf(chosen)
  return { steps, at, undoTo: at > 0 ? ns[at - 1]! : null }
}
