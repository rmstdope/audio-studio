import { z } from 'zod'
import type { Pixels } from './imagePixels'

/** How many pixels of a patch fade in from the edge of its marked area. */
export const PATCH_FEATHER = 24

/** The narrowest side a marked area may have, in pixels of the take. */
export const PATCH_SMALLEST = 8

/** The marked area of a take, in whole pixels of the picture the model made. */
export const PatchAreaSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
})

/** The marked area of a take. */
export type PatchArea = z.infer<typeof PatchAreaSchema>

/** What the page asks for to make a patch: the marked area and the edit instruction. */
export const MakePatchBody = z.strictObject({
  area: PatchAreaSchema,
  instruction: z.string().trim().min(1),
})

/** One patch saved on an image's patch board. */
export const PatchSchema = z.strictObject({
  n: z.number().int().positive(),
  /** The number of the take it was made from. */
  take: z.number().int().positive(),
  seed: z.number().int(),
  instruction: z.string(),
  area: PatchAreaSchema,
})

/** One patch saved on an image's patch board. */
export type Patch = z.infer<typeof PatchSchema>

/** An image's patch board: the next patch's number and the patches made so far. */
export const PatchBoardSchema = z.strictObject({
  next: z.number().int().positive(),
  patches: z.array(PatchSchema),
})

/** An image's patch board. */
export type PatchBoard = z.infer<typeof PatchBoardSchema>

/** The patches of an image's chosen take as the page shows them. */
export interface ImagePatchesView {
  /** The chosen take the patches lie over and its size, or null when there is no picture of one to patch. */
  take: { n: number; width: number; height: number } | null
  /** Whether a take is chosen but its picture is missing or cannot be read. */
  pictureGone: boolean
  /** The patches made from the chosen take, oldest first. */
  patches: Patch[]
  /** The patch being made or waiting for its turn. */
  making: { instruction: string; area: PatchArea } | null
  /** The last patch that could not be made, until the next one is asked for. */
  failed: { instruction: string; message: string } | null
  /** The folder, inside the project, the patches are saved in. */
  folder: string
}

/** Why this area cannot be patched on a picture of this size, or null when it can. */
export function checkPatchArea(
  area: PatchArea,
  size: { width: number; height: number },
): string | null {
  if (
    area.x < 0 ||
    area.y < 0 ||
    area.x + area.width > size.width ||
    area.y + area.height > size.height
  ) {
    return 'The marked area must be inside the picture.'
  }
  if (area.width < PATCH_SMALLEST || area.height < PATCH_SMALLEST) {
    return 'The marked area is too small to patch.'
  }
  return null
}

/**
 * The part of a whole edited picture to keep: the same size, its colours inside `area` and
 * transparent everywhere else, fading in over the soft edge so that it blends with the take below.
 * An area's side that lies on the picture's own edge has nothing to blend with and does not fade.
 */
export function keepArea(edited: Pixels, area: PatchArea, feather = PATCH_FEATHER): Pixels {
  const { width, height } = edited
  const soft = Math.max(1, Math.min(feather, Math.floor(Math.min(area.width, area.height) / 2)))
  const right = area.x + area.width
  const bottom = area.y + area.height
  const data = new Uint8Array(width * height * 4)
  for (let y = area.y; y < bottom; y++) {
    for (let x = area.x; x < right; x++) {
      const distance = Math.min(
        area.x > 0 ? x - area.x + 0.5 : Infinity,
        right < width ? right - x - 0.5 : Infinity,
        area.y > 0 ? y - area.y + 0.5 : Infinity,
        bottom < height ? bottom - y - 0.5 : Infinity,
      )
      const t = Math.min(1, distance / soft)
      const i = (y * width + x) * 4
      data[i] = edited.data[i]!
      data[i + 1] = edited.data[i + 1]!
      data[i + 2] = edited.data[i + 2]!
      data[i + 3] = Math.round(255 * t * t * (3 - 2 * t))
    }
  }
  return { width, height, data }
}
