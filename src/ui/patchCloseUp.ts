import type { CSSProperties } from 'react'
import type { PatchArea } from '../core/imagePatches'

/** The share of the area's width and height shown around it on each side. */
const AROUND = 0.25

/** The tallest a close-up is, as a multiple of its width. */
const TALLEST = 1.5

/** The widest a close-up is, as a multiple of its height. */
const WIDEST = 2.5

/** A span of `size` round the middle of `from`..`from + length`, moved inward to stay within 0..limit. */
function around(from: number, length: number, size: number, limit: number): [number, number] {
  if (size >= limit) return [0, limit]
  const start = Math.round(from + length / 2 - size / 2)
  const at = Math.min(Math.max(start, 0), limit - size)
  return [at, size]
}

/**
 * The part of a take a close-up shows: the area joined with what the take keeps (when it keeps
 * something), with a little around the two, in whole pixels, inside the picture. Never taller than
 * 1.5 times its width nor wider than 2.5 times its height: a thinner frame is widened (or
 * heightened) round the change, moved inward at an edge, and stops at the picture.
 */
export function closeUp(
  area: PatchArea,
  take: { width: number; height: number },
  kept: PatchArea | null = null,
): PatchArea {
  const left = kept ? Math.min(area.x, kept.x) : area.x
  const top = kept ? Math.min(area.y, kept.y) : area.y
  const joinedRight = kept
    ? Math.max(area.x + area.width, kept.x + kept.width)
    : area.x + area.width
  const joinedBottom = kept
    ? Math.max(area.y + area.height, kept.y + kept.height)
    : area.y + area.height
  const width = joinedRight - left
  const height = joinedBottom - top
  const x = Math.max(0, Math.round(left - width * AROUND))
  const y = Math.max(0, Math.round(top - height * AROUND))
  const right = Math.min(take.width, Math.round(joinedRight + width * AROUND))
  const bottom = Math.min(take.height, Math.round(joinedBottom + height * AROUND))
  // An area wholly outside the picture (the game cuts off its edges) shows the whole picture.
  if (right <= x || bottom <= y) return { x: 0, y: 0, width: take.width, height: take.height }
  const frame = { x, y, width: right - x, height: bottom - y }
  if (frame.height > frame.width * TALLEST) {
    const [at, size] = around(frame.x, frame.width, Math.ceil(frame.height / TALLEST), take.width)
    return { ...frame, x: at, width: size }
  }
  if (frame.width > frame.height * WIDEST) {
    const [at, size] = around(frame.y, frame.height, Math.ceil(frame.width / WIDEST), take.height)
    return { ...frame, y: at, height: size }
  }
  return frame
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
