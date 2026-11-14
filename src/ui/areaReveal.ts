/** The space left between the pinned bar, or the window's bottom, and a box scrolled into view. */
const GAP = 8

/**
 * How far the page must scroll (negative is up) for a box, given by its top and bottom in the
 * window, to be in view between the pinned bar's bottom and the window's bottom. Nothing
 * when it already is; the top wins when it cannot all fit.
 */
export function revealDelta(
  box: { top: number; bottom: number },
  barBottom: number,
  viewportHeight: number,
): number {
  if (box.bottom <= barBottom) return box.top - barBottom - GAP
  if (box.top >= viewportHeight) {
    return Math.min(box.bottom - viewportHeight + GAP, box.top - barBottom - GAP)
  }
  return 0
}

/** A point held inside the window and below `top` (the pinned bar), so a drag stops at what is in view. */
export function clampToWindow(
  point: { x: number; y: number },
  window: { width: number; height: number },
  top = 0,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(point.x, 0), window.width),
    y: Math.min(Math.max(point.y, top), window.height),
  }
}
