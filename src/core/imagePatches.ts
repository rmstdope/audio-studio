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

/** How many pixels outside a side of the marked area are compared with the take. */
export const PATCH_MATCH_BAND = 8

/** The drift from the take, out of 255 on the worst colour channel, above which a patch is taken as asked for. */
export const PATCH_BIG_DIFFERENCE = 30

/** The distance in pixels over which a big difference eases in from the sides. */
export const PATCH_EASE = 48

/** How many positions each way along a side are averaged, so that one speck does not set the colour. */
const MATCH_SMOOTH = 12

/** One side of the marked area with the colour offset (take minus edit) measured next to it. */
interface MatchSide {
  /** The distance in pixels from a point of the area to this side. */
  distance: (x: number, y: number) => number
  /** The offset by colour channel next to the place along the side that this point is nearest. */
  offsetAt: (x: number, y: number) => [number, number, number]
}

/**
 * The edited picture with its colours matched to the take around the marked area, so that the patch
 * shows no seam. Along each side of the area that is not on the picture's edge, the strip just
 * outside it tells how far the edit's colours drift from the take there, place by place, so an area
 * across a horizon is matched against the sky and the grass separately. A small drift is corrected
 * across the whole area; a big one (above `PATCH_BIG_DIFFERENCE`) is what was asked for, so only the
 * sides are brought to the take and the difference eases in from them. An area with no side to
 * look at is returned as painted.
 */
export function matchToTake(edited: Pixels, take: Pixels, area: PatchArea): Pixels {
  const { width, height } = edited
  const right = area.x + area.width
  const bottom = area.y + area.height
  const offsetAtPixel = (x: number, y: number): [number, number, number] => {
    const i = (y * width + x) * 4
    return [
      take.data[i]! - edited.data[i]!,
      take.data[i + 1]! - edited.data[i + 1]!,
      take.data[i + 2]! - edited.data[i + 2]!,
    ]
  }
  /** The smoothed offsets along one side: for each position, the mean over the strip and its neighbours. */
  const along = (
    count: number,
    start: number,
    pixel: (position: number, depth: number) => [number, number, number],
    depths: number,
  ): [number, number, number][] => {
    const raw = Array.from({ length: count }, (_, k) => {
      const sum: [number, number, number] = [0, 0, 0]
      for (let d = 0; d < depths; d++) {
        const o = pixel(start + k, d)
        sum[0] += o[0]
        sum[1] += o[1]
        sum[2] += o[2]
      }
      return sum.map((v) => v / depths) as [number, number, number]
    })
    return raw.map((_, k) => {
      const sum: [number, number, number] = [0, 0, 0]
      let n = 0
      for (let j = Math.max(0, k - MATCH_SMOOTH); j <= Math.min(count - 1, k + MATCH_SMOOTH); j++) {
        sum[0] += raw[j]![0]
        sum[1] += raw[j]![1]
        sum[2] += raw[j]![2]
        n++
      }
      return sum.map((v) => v / n) as [number, number, number]
    })
  }

  const sides: MatchSide[] = []
  const band = (room: number) => Math.min(PATCH_MATCH_BAND, room)
  if (area.x > 0) {
    const depths = band(area.x)
    const offsets = along(area.height, area.y, (y, d) => offsetAtPixel(area.x - 1 - d, y), depths)
    sides.push({
      distance: (x) => x - area.x + 0.5,
      offsetAt: (_x, y) => offsets[y - area.y]!,
    })
  }
  if (right < width) {
    const depths = band(width - right)
    const offsets = along(area.height, area.y, (y, d) => offsetAtPixel(right + d, y), depths)
    sides.push({
      distance: (x) => right - x - 0.5,
      offsetAt: (_x, y) => offsets[y - area.y]!,
    })
  }
  if (area.y > 0) {
    const depths = band(area.y)
    const offsets = along(area.width, area.x, (x, d) => offsetAtPixel(x, area.y - 1 - d), depths)
    sides.push({
      distance: (_x, y) => y - area.y + 0.5,
      offsetAt: (x) => offsets[x - area.x]!,
    })
  }
  if (bottom < height) {
    const depths = band(height - bottom)
    const offsets = along(area.width, area.x, (x, d) => offsetAtPixel(x, bottom + d), depths)
    sides.push({
      distance: (_x, y) => bottom - y - 0.5,
      offsetAt: (x) => offsets[x - area.x]!,
    })
  }

  const data = new Uint8Array(edited.data)
  if (sides.length === 0) return { width, height, data }

  // How far the edit drifts from the take around the area: the worst channel's mean size.
  const drift = [0, 0, 0]
  let samples = 0
  for (const side of sides) {
    for (let k = 0; k < Math.max(area.width, area.height); k++) {
      const o = side.offsetAt(Math.min(right - 1, area.x + k), Math.min(bottom - 1, area.y + k))
      for (let c = 0; c < 3; c++) drift[c]! += Math.abs(o[c]!)
      samples++
    }
  }
  const big = Math.max(...drift.map((v) => v / samples)) > PATCH_BIG_DIFFERENCE

  for (let y = area.y; y < bottom; y++) {
    for (let x = area.x; x < right; x++) {
      const sum = [0, 0, 0]
      let weights = 0
      let nearest = Infinity
      for (const side of sides) {
        const d = side.distance(x, y)
        nearest = Math.min(nearest, d)
        const w = 1 / ((d + 1) * (d + 1))
        const o = side.offsetAt(x, y)
        sum[0]! += w * o[0]
        sum[1]! += w * o[1]
        sum[2]! += w * o[2]
        weights += w
      }
      let strength = 1
      if (big) {
        const t = Math.min(1, nearest / PATCH_EASE)
        strength = 1 - t * t * (3 - 2 * t)
      }
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = edited.data[i + c]! + (strength * sum[c]!) / weights
        data[i + c] = Math.max(0, Math.min(255, Math.round(v)))
      }
    }
  }
  return { width, height, data }
}
