import { MIN_AREA_SIZE, type AreaBox } from '../core/images'

/** A point, in the image's pixels unless said otherwise. */
export interface Point {
  x: number
  y: number
}

/** What a picture measures. */
interface Size {
  width: number
  height: number
}

/** Where a picture is on the screen. */
interface Screen {
  left: number
  top: number
  width: number
  height: number
}

/** One of the eight handles of a selected box: its corners and sides. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Every handle, in the order they are drawn. */
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** How far an arrow key moves a box, or with Shift resizes it, in the image's pixels. */
export const ARROW_STEP = 4

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** A point on the screen as a point of the image, in whole pixels, stopping at the picture's edges. */
export function pointOnPicture(at: Point, picture: Screen, size: Size): Point {
  const along = (value: number, from: number, extent: number, pixels: number) =>
    Math.round((clamp(value - from, 0, extent) / extent) * pixels)
  return {
    x: along(at.x, picture.left, picture.width, size.width),
    y: along(at.y, picture.top, picture.height, size.height),
  }
}

/** The box between two points of a drag; null for a click, or a box too small to be one. */
export function boxFromDrag(a: Point, b: Point): AreaBox | null {
  const box = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
  return box.width < MIN_AREA_SIZE || box.height < MIN_AREA_SIZE ? null : box
}

/** The box moved by a distance, stopping at the picture's edges. */
export function moveBox(box: AreaBox, dx: number, dy: number, size: Size): AreaBox {
  return {
    ...box,
    x: clamp(box.x + dx, 0, size.width - box.width),
    y: clamp(box.y + dy, 0, size.height - box.height),
  }
}

/** The box with the edges a handle holds moved to the point, never smaller than the smallest box. */
export function resizeBox(box: AreaBox, handle: Handle, at: Point): AreaBox {
  let left = box.x
  let top = box.y
  let right = box.x + box.width
  let bottom = box.y + box.height
  if (handle.includes('w')) left = Math.min(at.x, right - MIN_AREA_SIZE)
  if (handle.includes('e')) right = Math.max(at.x, left + MIN_AREA_SIZE)
  if (handle.includes('n')) top = Math.min(at.y, bottom - MIN_AREA_SIZE)
  if (handle.includes('s')) bottom = Math.max(at.y, top + MIN_AREA_SIZE)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The box after an arrow key: moved by `ARROW_STEP`, or with Shift resized by its right and bottom
 * edges (Right and Down grow it, Left and Up shrink it); null for any other key.
 */
export function nudgeBox(box: AreaBox, key: string, shift: boolean, size: Size): AreaBox | null {
  const step: Record<string, Point> = {
    ArrowRight: { x: ARROW_STEP, y: 0 },
    ArrowLeft: { x: -ARROW_STEP, y: 0 },
    ArrowDown: { x: 0, y: ARROW_STEP },
    ArrowUp: { x: 0, y: -ARROW_STEP },
  }
  const by = step[key]
  if (!by) return null
  if (!shift) return moveBox(box, by.x, by.y, size)
  return {
    ...box,
    width: clamp(box.width + by.x, MIN_AREA_SIZE, size.width - box.x),
    height: clamp(box.height + by.y, MIN_AREA_SIZE, size.height - box.y),
  }
}

/** The id of the smallest box that holds the point, or null when none does. */
export function smallestAt(boxes: { id: string; box: AreaBox }[], at: Point): string | null {
  let found: { id: string; area: number } | null = null
  for (const { id, box } of boxes) {
    const inside =
      at.x >= box.x && at.x <= box.x + box.width && at.y >= box.y && at.y <= box.y + box.height
    const area = box.width * box.height
    if (inside && (!found || area < found.area)) found = { id, area }
  }
  return found?.id ?? null
}
