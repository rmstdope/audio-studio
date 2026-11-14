import { useCallback, useEffect, useRef } from 'react'

/**
 * The height from `top` (how far down the page a frame starts) to the bottom of a window
 * `innerHeight` tall, less `below`: the space the page keeps under the frame, so it ends inside it.
 */
export function fillHeight(innerHeight: number, top: number, below = 0): number {
  return Math.max(0, innerHeight - top - below)
}

/** What `spaceBelow` and `elementsAbove` read of a box in the page. */
export interface Node {
  parentElement: Node | null
  /** The boxes laid out before this one in its parent. */
  previousSiblings: Node[]
}

/** The padding and border under a box, as the computed style gives them. */
interface Under {
  paddingBottom: string
  borderBottomWidth: string
}

/**
 * The space the page keeps under `frame`: the padding and border under every box it sits in, so
 * the frame ends inside them all and not at the window's edge. It takes the frame to be the last
 * thing in each box (as every frame is), so anything laid out after it is not counted.
 */
export function spaceBelow<N extends Node>(frame: N, styleOf: (box: N) => Under): number {
  let total = 0
  for (let box = frame.parentElement as N | null; box; box = box.parentElement as N | null) {
    const under = styleOf(box)
    total += (parseFloat(under.paddingBottom) || 0) + (parseFloat(under.borderBottomWidth) || 0)
  }
  return total
}

/**
 * Every box laid out before `frame` or before a box it sits in: what can move the frame down or
 * up the page when its height changes.
 */
export function elementsAbove(frame: Node): Node[] {
  const above: Node[] = []
  for (let box: Node | null = frame; box; box = box.parentElement)
    above.push(...box.previousSiblings)
  return above
}

/** What `fillWindow` reads of an element, and sets on it. */
interface Fillable {
  getBoundingClientRect(): { top: number }
  style: { setProperty(name: string, value: string): void }
}

/**
 * Sets `--fill-height` on `element` to the room from where it starts to the bottom of the window,
 * measured as the page sits unscrolled, less `below` (`spaceBelow`). This is the one number a
 * picture page takes from the window: where the frame begins, never what is inside it, so a row
 * added to the page needs no new budget (as-5wln).
 */
export function fillWindow(
  element: Fillable,
  view: { innerHeight: number; scrollY: number },
  below: number,
): void {
  const top = element.getBoundingClientRect().top + view.scrollY
  element.style.setProperty('--fill-height', `${fillHeight(view.innerHeight, top, below)}px`)
}

/** An element as a box in the page, for `spaceBelow` and `elementsAbove`. */
function asNode(element: HTMLElement): Node & { element: HTMLElement } {
  return {
    element,
    get parentElement() {
      const parent = element.parentElement
      return parent && parent !== document.documentElement ? asNode(parent) : null
    },
    get previousSiblings() {
      const before: Node[] = []
      for (let at = element.previousElementSibling; at; at = at.previousElementSibling) {
        before.push({ element: at, parentElement: null, previousSiblings: [] } as Node)
      }
      return before
    },
  }
}

/**
 * A ref callback for a frame that fills the window below its own start: pass it as `ref` and give
 * the frame `height: var(--fill-height)`, or `min-height` when it may grow to what its rows hold
 * (Patches, Fine-tune). It follows the window's size and every box before the
 * frame, so it grows back when something above it goes away.
 */
export function useFillWindow(): (element: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  return useCallback((element: HTMLElement | null) => {
    stop.current?.()
    stop.current = null
    if (!element) return
    const update = () =>
      fillWindow(
        element,
        window,
        spaceBelow(asNode(element), (box) =>
          getComputedStyle((box as ReturnType<typeof asNode>).element),
        ),
      )
    update()
    window.addEventListener('resize', update)
    // A size seen by the observer is acted on in the next frame, never inside its delivery: the new
    // height resizes the body it watches, and a box resized inside its own delivery is refused
    // ("ResizeObserver loop completed with undelivered notifications", as-tp58).
    let frame = 0
    const later = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        update()
      })
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later)
    // The boxes before the frame come and go (a notice, a failure line): each is watched while it
    // is there, and a change of what is there asks again, since the body, at least a window tall,
    // does not change size when a box that filled it goes away.
    const watch = () => {
      observer?.disconnect()
      for (const above of elementsAbove(asNode(element))) {
        observer?.observe((above as ReturnType<typeof asNode>).element)
      }
      observer?.observe(document.body)
    }
    watch()
    const mutations = new MutationObserver(() => {
      watch()
      update()
    })
    mutations.observe(document.body, { childList: true, subtree: true })
    stop.current = () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
      mutations.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
}
