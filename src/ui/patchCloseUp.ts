import type { CSSProperties } from 'react'
import type { PatchArea } from '../core/imagePatches'

/** The share of the area's width and height shown around it on each side. */
const AROUND = 0.25

/** The part of a take a close-up shows: the area with a little around it, in whole pixels, inside the picture. */
export function closeUp(area: PatchArea, take: { width: number; height: number }): PatchArea {
  const x = Math.max(0, Math.round(area.x - area.width * AROUND))
  const y = Math.max(0, Math.round(area.y - area.height * AROUND))
  const right = Math.min(take.width, Math.round(area.x + area.width * (1 + AROUND)))
  const bottom = Math.min(take.height, Math.round(area.y + area.height * (1 + AROUND)))
  // An area wholly outside the picture (the game cuts off its edges) shows the whole picture.
  if (right <= x || bottom <= y) return { x: 0, y: 0, width: take.width, height: take.height }
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * Where a whole picture of this size lies inside a frame that shows only `crop` of it, in the
 * percentages of the frame: the picture is scaled up and moved so that the crop fills the frame.
 */
export function closeUpLayer(
  crop: PatchArea,
  take: { width: number; height: number },
): CSSProperties {
  return {
    width: `${(take.width / crop.width) * 100}%`,
    height: `${(take.height / crop.height) * 100}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
  }
}
