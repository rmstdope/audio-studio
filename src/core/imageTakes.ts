import { z } from 'zod'
import { ChosenEntrySchema, type MadeFrom } from './images'
import { IMAGE_MODEL_IDS, MAX_IMAGE_SIDE, type ImageModelId } from './imageModels'

/** The longer side of a take as the model makes it, in pixels. */
const TAKE_LONG_SIDE = 1024

/**
 * The size a take is made at: the image's shape with the longer side 1024, each side a multiple of
 * 16 (the models' rule) and at least 16. The game's listed sizes are not multiples of 16; bringing
 * a take to the listed size is as-yag.5's.
 */
export function takeSize(image: { width: number; height: number }): {
  width: number
  height: number
} {
  const scale = TAKE_LONG_SIDE / Math.max(image.width, image.height)
  const side = (pixels: number) =>
    Math.min(MAX_IMAGE_SIDE, Math.max(16, Math.round((pixels * scale) / 16) * 16))
  return { width: side(image.width), height: side(image.height) }
}

/** A take on an image's board: made, its picture a PNG beside the board. */
export const BoardTakeSchema = z.object({
  /** Per image, never reused. */
  n: z.number().int().positive(),
  seed: z.number().int().nonnegative(),
  /** The `--model` name of the model that made it. */
  model: z.string(),
  /** The size of the picture the model made. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** What it was made from: the words, the style and the size asked for. */
  madeFrom: z.object({
    words: z.string(),
    style: z.string(),
    width: z.number(),
    height: z.number(),
  }),
  /** What the game's version was brought to (`lookKey`); absent until it is. */
  look: z.string().optional(),
  /** It has been shown on the right once; a take that has not shows "new". */
  seen: z.boolean().default(false),
})

/** An image's board, `.audio-studio/images/<id>.json`: the takes made, and the next number. */
export const ImageBoardSchema = z.object({
  next: z.number().int().positive().default(1),
  takes: z.array(BoardTakeSchema).default([]),
})

/** A take on a board. */
export type ImageBoardTake = z.infer<typeof BoardTakeSchema>
/** An image's board. */
export type ImageBoard = z.infer<typeof ImageBoardSchema>

/** Whether a take was made from other words than the image has now. */
export function takeIsEarlier(made: MadeFrom, wordsNow: string): boolean {
  return made.words !== wordsNow
}

/**
 * The body of asking for takes: this many new ones (1 to 4), with the model to make them with
 * (the project's, else the one that is here, when it is left out), or the failed take with this
 * number again.
 */
export const MakeImageTakesBody = z.union([
  z
    .object({ count: z.number().int().min(1).max(4), model: z.enum(IMAGE_MODEL_IDS).optional() })
    .strict(),
  z.object({ retry: z.number().int().positive() }).strict(),
])

/** The body of choosing a take. */
export const ChooseImageTakeBody = z.object({ n: z.number().int().positive() }).strict()

/** A take as the page shows it. */
export interface ImageTakeView {
  n: number
  width: number
  height: number
  /** The model that made it; null for a name the studio does not know. */
  model: ImageModelId | null
  /** Made from words that have since changed. */
  earlier: boolean
  /** The game uses it. */
  chosen: boolean
  /** Not yet shown on the right. */
  isNew: boolean
  /**
   * The game's version: brought to the look now, being brought, brought to another look, or not
   * there (never brought, or its file is gone).
   */
  look: 'ready' | 'bringing' | 'old' | 'missing'
  /** The model's picture has another shape than the image, so the game's version cuts its edges. */
  cropped: boolean
}

/** A take waiting or being made. */
export interface ImageMakingView {
  n: number
  state: 'waiting' | 'making'
  /** Seconds since it started; 0 while it waits. */
  elapsed: number
  /** Seconds a take of this model is expected to take (a guess). */
  expected: number
}

/** A take that failed, kept until it is made again. */
export interface ImageFailedView {
  n: number
  message: string
}

/** Whether takes can be made on this computer, and what is missing if not. */
export type ImageGeneratorView = { ok: true } | { ok: false; message: string; fix: string }

/** An image's takes as its page shows them. */
export interface ImageTakesView {
  ok: true
  generator: ImageGeneratorView
  /** The project's main image model (Setup's). */
  projectModel: ImageModelId
  /** Every image model, and whether this computer has its weights. */
  models: { id: ImageModelId; installed: boolean }[]
  takes: ImageTakeView[]
  making: ImageMakingView[]
  failed: ImageFailedView[]
  /** The lock cannot be read, so which take is chosen is not known. */
  lockUnread: boolean
  /** Why the takes cannot be brought to the game's look (the style file); null when they can. */
  lookError: string | null
}

/** What is being made for an image, for the act's list. */
export interface ImageMakingSummary {
  takes: number
  /** Seconds left, all together (a guess). */
  left: number
}

/**
 * The take one step along the strip from `current` (-1 earlier, 1 later), stopping at its ends.
 * With none on the right the newest comes first. Null when the strip is empty.
 */
export function stepRight(strip: number[], current: number | null, delta: -1 | 1): number | null {
  if (!strip.length) return null
  const at = current === null ? -1 : strip.indexOf(current)
  if (at === -1) return strip[strip.length - 1]!
  return strip[Math.min(strip.length - 1, Math.max(0, at + delta))]!
}

/** The take that comes right after `n` is dropped: the next in the strip, else the previous, else none. */
export function rightAfterDrop(strip: number[], n: number): number | null {
  const at = strip.indexOf(n)
  const rest = strip.filter((m) => m !== n)
  if (!rest.length) return null
  return rest[Math.min(Math.max(at, 0), rest.length - 1)]!
}

/** `manifest.json` of the images clips folder, which the game reads: `{ image: { file, width, height } }`. */
export const ImageManifestSchema = z.record(
  z.string(),
  z.looseObject({ file: z.string(), width: z.number(), height: z.number() }),
)

/** The images manifest. */
export type ImageManifest = z.infer<typeof ImageManifestSchema>

/** The lock file as the studio writes it: the chosen take of each image, and any other key kept as it was. */
export const ImageLockFileSchema = z.looseObject({
  images: z.record(z.string(), z.looseObject({ chosen: ChosenEntrySchema.optional() })).default({}),
})

/** The images lock file. */
export type ImageLockFile = z.infer<typeof ImageLockFileSchema>

/** Bringing the images and their takes to the game's new look, as the page polls it. */
export interface LookRunView {
  /** Still going. */
  running: boolean
  /** Images to bring, and how many are done (brought or failed). */
  total: number
  done: number
  /** Images that could not be brought, with why. */
  failed: { id: string; reason: 'missing' | string }[]
}
