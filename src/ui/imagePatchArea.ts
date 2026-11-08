import { checkPatchArea, type PatchArea } from '../core/imagePatches'

/** A point on the screen. */
interface Point {
  x: number
  y: number
}

/** Where a picture is on the screen. */
interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** How near a picture's edge, in screen pixels, a drag counts as reaching it. */
const EDGE_REACH = 4

/**
 * The marked area of a drag over a picture, in the pixels of the take it shows, stopping at the
 * picture's edges, and with a side just short of an edge (`EDGE_REACH`) on it, so that no aim is
 * needed to mark up to the edge; null for a click, or for a drag too small to patch. A picture that is not
 * the model's own (the game's version) gives its `unplace` to turn the area back into the model's pixels.
 */
export function areaFromDrag(
  start: Point,
  end: Point,
  box: Box,
  take: { width: number; height: number },
  unplace: (area: PatchArea) => PatchArea = (area) => area,
  model: { width: number; height: number } = take,
): PatchArea | null {
  const along = (at: number, from: number, size: number, pixels: number) => {
    const inside = at - from
    const reached = inside <= EDGE_REACH ? 0 : inside >= size - EDGE_REACH ? size : inside
    return Math.round((reached / size) * pixels)
  }
  const x1 = along(start.x, box.left, box.width, take.width)
  const x2 = along(end.x, box.left, box.width, take.width)
  const y1 = along(start.y, box.top, box.height, take.height)
  const y2 = along(end.y, box.top, box.height, take.height)
  const area = {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x1 - x2),
    height: Math.abs(y1 - y2),
  }
  if (checkPatchArea(area, take)) return null
  const marked = unplace(area)
  return checkPatchArea(marked, model) ? null : marked
}

/** Whether two marked areas are the same box. */
export function sameArea(a: PatchArea, b: PatchArea | null): boolean {
  return b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
