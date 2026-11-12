/** What `scrollWithin` reads and moves: a box's place on screen, and a scroller's offsets. */
interface Placed {
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number }
}

/**
 * Scrolls `box` just enough that `item` is wholly in view inside it, as `scrollIntoView` with
 * `'nearest'` would, but moves no other scroller and never the page. A strip or grid of takes keeps
 * the one stepped to in view without pulling the page down to it, so the previous/next arrows stay
 * under the pointer (as-pbby).
 */
export function scrollWithin(
  item: Placed | null | undefined,
  box: (Placed & { scrollLeft: number; scrollTop: number }) | null | undefined,
): void {
  if (!item || !box) return
  const outer = box.getBoundingClientRect()
  const inner = item.getBoundingClientRect()
  box.scrollLeft += nearest(inner.left, inner.right, outer.left, outer.right)
  box.scrollTop += nearest(inner.top, inner.bottom, outer.top, outer.bottom)
}

/**
 * How far to scroll along one axis to bring [start, end] inside [from, to]: the start wins when
 * it cannot all fit.
 */
function nearest(start: number, end: number, from: number, to: number): number {
  if (start < from) return start - from
  if (end > to) return Math.min(end - to, start - from)
  return 0
}
