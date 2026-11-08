import { z } from 'zod'
import type { AreaBox } from './images'
import type { Look, LookSize } from './imageLook'
import { bringToLook, type Pixels } from './imagePixels'

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

/** One take of a patch on its board: a picture beside the board, as big as the image's take it lies over. */
export const PatchTakeSchema = z.strictObject({
  /** Per patch, never reused. */
  n: z.number().int().positive(),
  /** The number of the image's take it was painted on. */
  base: z.number().int().positive(),
  seed: z.number().int(),
  /** The patch's words it was made from. */
  words: z.string(),
  /** The area it was made with. */
  area: PatchAreaSchema,
  /** It has been laid over the picture once; a take that has not shows "new". */
  seen: z.boolean().default(false),
  /** What its game version (`<n>.game.png`) was brought to (`lookKey`); absent until it is. */
  look: z.string().optional(),
})

/** One take of a patch. */
export type PatchTake = z.infer<typeof PatchTakeSchema>

/**
 * A patch's board, `content-studio/cache/image-patches/<image>/<patch>/board.json`: the takes made,
 * the next number, and the take chosen on each take of the image (by its number).
 */
export const PatchBoardSchema = z.strictObject({
  next: z.number().int().positive().default(1),
  takes: z.array(PatchTakeSchema).default([]),
  chosen: z.record(z.string(), z.number().int().positive()).default({}),
  /**
   * The take of the patch the game gets on each take of the image: set by Choose, taken away by
   * Un-choose. A choice made before the game got patches is in `chosen` only.
   */
  inGame: z.record(z.string(), z.number().int().positive()).default({}),
})

/** A patch's board. */
export type PatchBoard = z.infer<typeof PatchBoardSchema>

/** The body of asking for takes of a patch: this many new ones (1 to 4) of an area, or a failed take again. */
export const MakePatchTakesBody = z.union([
  z.strictObject({ count: z.number().int().min(1).max(4), area: PatchAreaSchema }),
  z.strictObject({ retry: z.number().int().positive() }),
])

/** The body of choosing a take of a patch. */
export const ChoosePatchTakeBody = z.strictObject({ n: z.number().int().positive() })

/** A take of a patch as the page shows it. */
export interface PatchTakeView {
  n: number
  area: PatchArea
  /** Made from words that have since changed. */
  earlier: boolean
  chosen: boolean
  /** Not yet laid over the picture. */
  isNew: boolean
  /**
   * The game's version: brought to the look now, being brought, brought to another look, or not
   * there (never brought, or its file is gone).
   */
  look: 'ready' | 'bringing' | 'old' | 'missing'
}

/** A take of a patch waiting or being made. */
export interface PatchMakingView {
  n: number
  state: 'waiting' | 'making'
  /** Seconds since it started; 0 while it waits. */
  elapsed: number
  /** Seconds an edit is expected to take (a guess). */
  expected: number
  area: PatchArea
}

/** A take of a patch that failed, kept until it is made again. */
export interface PatchFailedView {
  n: number
  message: string
  area: PatchArea
}

/** One patch of an image with its takes on the image's chosen take. */
export interface PatchWorkView {
  id: string
  takes: PatchTakeView[]
  making: PatchMakingView[]
  failed: PatchFailedView[]
  /** The patch is in the game, in another look than the style asks for now. */
  oldLook: boolean
}

/** The patches of an image as the page shows them: those made on the take the game shows. */
export interface ImagePatchesView {
  ok: true
  /** The chosen take the patches lie over and its size, or null when there is no picture of one to patch. */
  take: { n: number; width: number; height: number; cropped: boolean } | null
  /** The size the game shows the image at. */
  game: { width: number; height: number }
  /** Why the takes cannot be brought to the game's look (the style); null when they can. */
  lookError: string | null
  /** What the game's versions are brought to now (`lookKey`); null when the style cannot be used. */
  lookKey: string | null
  /** The images lock cannot be read, so which take of the image is chosen is not known. */
  lockUnread: boolean
  /** Whether a take is chosen but its picture is missing or cannot be read. */
  pictureGone: boolean
  /** Whether takes of patches can be made on this computer, and why not if they cannot. */
  maker: { ok: true } | { ok: false; message: string }
  /** The image's patches the game lists, each with its takes. */
  patches: PatchWorkView[]
}

/**
 * What a closed patch row says of how far the patch has come: "no takes yet", "2 takes, none
 * chosen", or "3 takes" with the chip naming the chosen take.
 */
export function patchSummary(takes: readonly { n: number; chosen: boolean }[]): {
  text: string
  chip: string | null
} {
  if (takes.length === 0) return { text: 'no takes yet', chip: null }
  const count = `${takes.length} ${takes.length === 1 ? 'take' : 'takes'}`
  const chosen = takes.find((t) => t.chosen)
  return chosen
    ? { text: count, chip: `Take ${chosen.n} chosen` }
    : { text: `${count}, none chosen`, chip: null }
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

/** The difference from the take inside the area once the drift is corrected, out of 255 on the worst colour channel, above which a patch is taken as asked for. */
export const PATCH_BIG_DIFFERENCE = 30

/** The distance in pixels over which a big difference eases in from the sides. */
export const PATCH_EASE = 48

/** How many positions each way along a side the median is taken over, so that one speck does not set the colour. */
const MATCH_SMOOTH = 24

/** Out of 255, how far a place along a side may differ from the drift around the area and still be followed in full. */
const MATCH_FOLLOW = 22

/** Out of 255, how far beyond `MATCH_FOLLOW` a place may differ before it is not followed at all: it is something the edit painted there. */
const MATCH_IGNORE = 8

/** The median of the values, which it sorts in place. */
const middle = (values: number[]) => values.sort((x, y) => x - y)[values.length >> 1]!

/** Out of 255, how close two offsets must be on every channel to count as the same tone when grouping the places. */
const MATCH_SAME = 8

/** At most this many offsets are compared with each other when grouping the places. */
const MATCH_SAMPLES = 400

/** Whether two offsets are within `limit` of each other on every channel. */
const within = (a: number[], b: number[], limit: number) =>
  [0, 1, 2].every((c) => Math.abs(a[c]! - b[c]!) <= limit)

/**
 * The offset to take as the drift around the area: of the tones that many places agree on (within
 * `MATCH_SAME` on every channel; any group at least a quarter as big as the biggest), the one
 * nearest `anchor`, the median offset of the whole picture, as the median of that group, or the anchor itself when that group is more than `MATCH_FOLLOW` from it and at least a tenth of the places agree with the anchor (within `MATCH_SAME`). The whole
 * picture is mostly untouched by the edit, so its median is the drift even where objects cover most
 * of the strip around the area, unless no place of the strip agrees with it (a sky shifted far while the rest stayed), when the strip's own tone is taken, and among tones that are about equally common (a gradual drift) it
 * keeps the middle one instead of an end.
 */
function driftAround(offsets: [number, number, number][], anchor: number[]): number[] {
  const step = Math.max(1, Math.ceil(offsets.length / MATCH_SAMPLES))
  const sample = offsets.filter((_, k) => k % step === 0)
  const groups = sample.map((o) => sample.filter((other) => within(o, other, MATCH_SAME)))
  const biggest = Math.max(...groups.map((g) => g.length))
  let best: number[] = anchor
  let nearest = Infinity
  for (const group of groups) {
    if (group.length * 4 < biggest) continue
    const centre = [0, 1, 2].map((c) => middle(group.map((o) => o[c]!)))
    const gap = [0, 1, 2].reduce((sum, c) => sum + Math.abs(centre[c]! - anchor[c]!), 0)
    if (gap < nearest) {
      nearest = gap
      best = centre
    }
  }
  if (within(best, anchor, MATCH_FOLLOW)) return best
  // A tone far from the picture's own median is objects, not drift, when the strip holds a real
  // cluster of places at that median (a few blended or stray places are not one). With none, the
  // edit changed all of what lies around the area (a sky shifted while the rest of the picture
  // stayed) and the strip's own tone is the drift.
  const atAnchor = sample.filter((o) => within(o, anchor, MATCH_SAME)).length
  return atAnchor * 10 >= sample.length ? anchor : best
}

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
 * across a horizon is matched against the sky and the grass separately. A small difference (the drift is all
 * there is) is corrected across the whole area; a big one (above `PATCH_BIG_DIFFERENCE`, left inside the area once the drift outside is corrected) is what was asked for, so only the
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
  /** The offsets along one side: for each position, the mean over the strip's depth. */
  const along = (
    count: number,
    start: number,
    pixel: (position: number, depth: number) => [number, number, number],
    depths: number,
  ): [number, number, number][] =>
    Array.from({ length: count }, (_, k) => {
      const sum: [number, number, number] = [0, 0, 0]
      for (let d = 0; d < depths; d++) {
        const o = pixel(start + k, d)
        sum[0] += o[0]
        sum[1] += o[1]
        sum[2] += o[2]
      }
      return sum.map((v) => v / depths) as [number, number, number]
    })
  /** The offsets with each position replaced by the median over its neighbours: it follows a step such as a horizon instead of smearing it. */
  const smooth = (raw: [number, number, number][]): [number, number, number][] =>
    raw.map((_, k) => {
      const window = raw.slice(
        Math.max(0, k - MATCH_SMOOTH),
        Math.min(raw.length, k + MATCH_SMOOTH + 1),
      )
      return [0, 1, 2].map((c) => middle(window.map((o) => o[c]!))) as [number, number, number]
    })

  const band = (room: number) => Math.min(PATCH_MATCH_BAND, room)
  const strips: {
    offsets: [number, number, number][]
    distance: MatchSide['distance']
    index: (x: number, y: number) => number
  }[] = []
  if (area.x > 0) {
    const offsets = along(
      area.height,
      area.y,
      (y, d) => offsetAtPixel(area.x - 1 - d, y),
      band(area.x),
    )
    strips.push({ offsets, distance: (x) => x - area.x + 0.5, index: (_x, y) => y - area.y })
  }
  if (right < width) {
    const offsets = along(
      area.height,
      area.y,
      (y, d) => offsetAtPixel(right + d, y),
      band(width - right),
    )
    strips.push({ offsets, distance: (x) => right - x - 0.5, index: (_x, y) => y - area.y })
  }
  if (area.y > 0) {
    const offsets = along(
      area.width,
      area.x,
      (x, d) => offsetAtPixel(x, area.y - 1 - d),
      band(area.y),
    )
    strips.push({ offsets, distance: (_x, y) => y - area.y + 0.5, index: (x) => x - area.x })
  }
  if (bottom < height) {
    const offsets = along(
      area.width,
      area.x,
      (x, d) => offsetAtPixel(x, bottom + d),
      band(height - bottom),
    )
    strips.push({ offsets, distance: (_x, y) => bottom - y - 0.5, index: (x) => x - area.x })
  }

  // Something the edit painted just outside the area (a bird, a cloud) is far from the drift
  // around the area, and carried inward it would streak the area: such a place takes that
  // tone instead, gradually, so no hard step shows. This is judged before smoothing, so that
  // objects covering most of a side cannot outvote the sky.
  if (strips.length > 0) {
    // The median offset of the whole picture outside the area, from a sparse grid of places.
    const grid: [number, number, number][] = []
    const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / MATCH_SAMPLES)))
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        if (x >= area.x && x < right && y >= area.y && y < bottom) continue
        grid.push(offsetAtPixel(x, y))
      }
    }
    const basis = grid.length > 0 ? grid : strips.flatMap((strip) => strip.offsets)
    const anchor = [0, 1, 2].map((c) => middle(basis.map((o) => o[c]!)))
    const reference = driftAround(
      strips.flatMap((strip) => strip.offsets),
      anchor,
    )
    for (const { offsets } of strips) {
      for (const o of offsets) {
        for (let c = 0; c < 3; c++) {
          const t = Math.max(
            0,
            Math.min(1, (Math.abs(o[c]! - reference[c]!) - MATCH_FOLLOW) / MATCH_IGNORE),
          )
          o[c] = o[c]! + (reference[c]! - o[c]!) * t * t * (3 - 2 * t)
        }
      }
    }
  }
  const sides: MatchSide[] = strips.map((strip) => {
    const offsets = smooth(strip.offsets)
    return { distance: strip.distance, offsetAt: (x, y) => offsets[strip.index(x, y)]! }
  })

  const data = new Uint8Array(edited.data)
  if (sides.length === 0) return { width, height, data }

  // The correction at each pixel of the area: the sides' offsets, weighted by closeness.
  const correction = new Float32Array(area.width * area.height * 3)
  const nearest = new Float32Array(area.width * area.height)
  for (let y = area.y; y < bottom; y++) {
    for (let x = area.x; x < right; x++) {
      const sum = [0, 0, 0]
      let weights = 0
      let near = Infinity
      for (const side of sides) {
        const d = side.distance(x, y)
        near = Math.min(near, d)
        const w = 1 / ((d + 1) * (d + 1))
        const o = side.offsetAt(x, y)
        sum[0]! += w * o[0]
        sum[1]! += w * o[1]
        sum[2]! += w * o[2]
        weights += w
      }
      const k = (y - area.y) * area.width + (x - area.x)
      for (let c = 0; c < 3; c++) correction[k * 3 + c] = sum[c]! / weights
      nearest[k] = near
    }
  }

  // How far the edit still differs from the take inside the area once the drift outside is
  // corrected: what the instruction asked for. Little is a drift; a lot is taken as asked for.
  const residual = [0, 0, 0]
  for (let y = area.y; y < bottom; y++) {
    for (let x = area.x; x < right; x++) {
      const k = (y - area.y) * area.width + (x - area.x)
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        residual[c]! += Math.abs(edited.data[i + c]! + correction[k * 3 + c]! - take.data[i + c]!)
      }
    }
  }
  const big = Math.max(...residual) / (area.width * area.height) > PATCH_BIG_DIFFERENCE

  for (let y = area.y; y < bottom; y++) {
    for (let x = area.x; x < right; x++) {
      const k = (y - area.y) * area.width + (x - area.x)
      let strength = 1
      if (big) {
        const t = Math.min(1, nearest[k]! / PATCH_EASE)
        strength = 1 - t * t * (3 - 2 * t)
      }
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = edited.data[i + c]! + strength * correction[k * 3 + c]!
        data[i + c] = Math.max(0, Math.min(255, Math.round(v)))
      }
    }
  }
  return { width, height, data }
}

/** The named area the game ties a patch to: its title, and where it is (null while it is not placed). */
export interface PatchTie {
  title: string
  box: AreaBox | null
}

/**
 * The mark a named area gives a patch on a take: the area (a box in the image's pixels, scaled to
 * the take's), grown on every side by the patch's feather so the soft edge fades outside the
 * thing it changes, and stopping at the picture's edges. Null when the result cannot be patched.
 */
export function markFromArea(
  box: AreaBox,
  image: { width: number; height: number },
  take: { width: number; height: number },
): PatchArea | null {
  const sx = take.width / image.width
  const sy = take.height / image.height
  const x1 = Math.max(0, Math.round(box.x * sx) - PATCH_FEATHER)
  const y1 = Math.max(0, Math.round(box.y * sy) - PATCH_FEATHER)
  const x2 = Math.min(take.width, Math.round((box.x + box.width) * sx) + PATCH_FEATHER)
  const y2 = Math.min(take.height, Math.round((box.y + box.height) * sy) + PATCH_FEATHER)
  const mark = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
  return checkPatchArea(mark, take) ? null : mark
}

/**
 * The patch as the game gets it: a transparent picture of the game's size that keeps only the dots
 * the patch changes. The take with the patch painted in (the patch blended over it by its own
 * transparency) and the take alone are both brought to the look, and a dot of the first that
 * differs from the second is kept, fully solid; every other dot is fully transparent. The soft
 * edge thus fades out in the look's own dither, and laid over the take's game version the result
 * is exactly the painted take brought to the look.
 */
export function gamePatch(take: Pixels, patch: Pixels, look: Look, size: LookSize): Pixels {
  const blended = new Uint8Array(take.data)
  for (let i = 0; i < blended.length; i += 4) {
    const a = patch.data[i + 3]! / 255
    if (a === 0) continue
    for (let c = 0; c < 3; c++) {
      blended[i + c] = Math.round(take.data[i + c]! * (1 - a) + patch.data[i + c]! * a)
    }
  }
  const before = bringToLook(take, look, size)
  const after = bringToLook({ ...take, data: blended }, look, size)
  const data = new Uint8Array(size.width * size.height * 4)
  for (let i = 0; i < data.length; i += 4) {
    if (
      before.data[i] === after.data[i] &&
      before.data[i + 1] === after.data[i + 1] &&
      before.data[i + 2] === after.data[i + 2]
    ) {
      continue
    }
    data.set([after.data[i]!, after.data[i + 1]!, after.data[i + 2]!, 255], i)
  }
  return { width: size.width, height: size.height, data }
}
