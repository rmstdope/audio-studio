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

/**
 * The marked area of a drag over a picture, in the pixels of the take it shows, stopping at the
 * picture's edges; null for a click, or for a drag too small to patch.
 */
export function areaFromDrag(
  start: Point,
  end: Point,
  box: Box,
  take: { width: number; height: number },
): PatchArea | null {
  const along = (at: number, from: number, size: number, pixels: number) =>
    Math.round((Math.min(Math.max(at - from, 0), size) / size) * pixels)
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
  return checkPatchArea(area, take) ? null : area
}

/** Whether two marked areas are the same box. */
export function sameArea(a: PatchArea, b: PatchArea | null): boolean {
  return b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
