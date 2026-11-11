import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tipPlace } from '../off'

/** What a greyed control carries: `aria-disabled` and its reason (see `off`). */
const GREYED = '[aria-disabled="true"][data-why]'

/** What any control with a tip carries: its reason, greyed or only dimmed (see `tipOnly`). */
const TIPPED = '[data-why]'

/** How long the tip stays after the pointer leaves, so it can be moved onto and read. */
const LINGER_MS = 150

/** The gap between a control and its tip, in pixels. */
const GAP = 6

/** The keys that still do something on a greyed control: moving on and closing the tip. */
const LEFT_ALONE = new Set(['Tab', 'Shift', 'Escape'])

/** The id of the tip, which the shown control is described by. */
const TIP_ID = 'why-tip'

/** Whether a key press would press `target` (a button) or change it (a menu or field). */
function actsOn(target: HTMLElement, event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || LEFT_ALONE.has(event.key)) return false
  // A greyed button is only pressed by Enter and Space; every other key is the page's.
  if (target instanceof HTMLButtonElement || target.tagName === 'A') {
    return event.key === 'Enter' || event.key === ' '
  }
  return true
}

/** The control with a tip (greyed or not) an event happened in, if any. */
function tippedIn(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(TIPPED) : null
}

/** The greyed control an event happened in, if any. */
function greyedIn(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(GREYED) : null
}

/**
 * The one tip for every greyed control, mounted once in the app. It listens to the whole document,
 * so a control needs only `off(...)` spread on it (or `tipOnly(...)` for one that stays pressable,
 * which gets the same tip without being made inert): the tip shows the control's reason at once on
 * hover, focus or a tap, above it (below when there is no room, inward near an edge), follows the
 * reason as it changes and goes when the control turns on. It also makes a greyed control inert:
 * pressing, typing in or changing it does nothing, while Tab still reaches it.
 */
export function WhyTip() {
  const [shown, setShown] = useState<{ target: HTMLElement; text: string } | null>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const lingering = useRef<ReturnType<typeof setTimeout> | null>(null)
  // What showed the tip: the pointer's leaving hides only a tip the pointer (or a tap) showed, since
  // the browser also reports the pointer over whatever the page moves under it while it rests.
  const shownBy = useRef<'pointer' | 'focus'>('pointer')

  useEffect(() => {
    const cancel = () => {
      if (lingering.current) clearTimeout(lingering.current)
      lingering.current = null
    }
    const show = (target: HTMLElement, by: 'pointer' | 'focus') => {
      cancel()
      shownBy.current = by
      const text = target.dataset.why ?? ''
      setShown((now) => (now?.target === target && now.text === text ? now : { target, text }))
    }
    const hide = () => {
      cancel()
      setShown(null)
    }
    const hideSoon = () => {
      cancel()
      lingering.current = setTimeout(hide, LINGER_MS)
    }
    const inTip = (t: EventTarget | null) => t instanceof Element && !!t.closest('.why-tip')
    const stop = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const on: [string, (e: Event) => void][] = [
      [
        'pointerover',
        (e) => {
          const target = tippedIn(e.target)
          if (target) show(target, 'pointer')
          else if (inTip(e.target)) cancel()
          else if (shownRef.current && shownBy.current === 'pointer') hideSoon()
        },
      ],
      [
        'pointerdown',
        (e) => {
          // A greyed control's press is stopped on `mousedown` and `click`, not here: cancelling
          // `pointerdown` would also drop the mouse events that guard is waiting for.
          if (!tippedIn(e.target) && !inTip(e.target)) hide()
        },
      ],
      ['mousedown', (e) => greyedIn(e.target) && stop(e)],
      [
        'click',
        (e) => {
          const target = tippedIn(e.target)
          if (!target) return
          if (target.matches(GREYED)) stop(e)
          show(target, 'pointer')
        },
      ],
      [
        'focusin',
        (e) => {
          const target = tippedIn(e.target)
          if (target) show(target, 'focus')
          else hide()
        },
      ],
      ['focusout', hide],
      [
        'keydown',
        (e) => {
          const key = (e as KeyboardEvent).key
          const on = greyedIn(e.target)
          if (key === 'Escape' && shownRef.current) {
            // Esc closes the tip; it is the page's too unless the tip's own control has focus.
            const own = tippedIn(e.target) === shownRef.current.target
            hide()
            if (own) e.stopPropagation()
            return
          }
          if (on && actsOn(on, e as KeyboardEvent)) stop(e)
        },
      ],
      [
        'keyup',
        (e) => {
          const on = greyedIn(e.target)
          if (on && actsOn(on, e as KeyboardEvent)) stop(e)
        },
      ],
      ['change', (e) => greyedIn(e.target) && stop(e)],
      ['input', (e) => greyedIn(e.target) && stop(e)],
      ['beforeinput', (e) => greyedIn(e.target) && stop(e)],
      ['paste', (e) => greyedIn(e.target) && stop(e)],
      ['cut', (e) => greyedIn(e.target) && stop(e)],
      ['drop', (e) => greyedIn(e.target) && stop(e)],
    ]
    for (const [type, handler] of on) document.addEventListener(type, handler, true)

    // The shown control's reason changing, it turning on, or leaving the page.
    const watching = new MutationObserver(() => {
      const now = shownRef.current
      if (!now) return
      if (!now.target.isConnected || !now.target.matches(TIPPED)) hide()
      else {
        const text = now.target.dataset.why ?? ''
        setShown((then) => (then && then.text !== text ? { target: then.target, text } : then))
      }
    })
    watching.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-why', 'aria-disabled'],
    })

    return () => {
      for (const [type, handler] of on) document.removeEventListener(type, handler, true)
      watching.disconnect()
      cancel()
    }
  }, [])

  // The shown control is described by the tip, so a screen reader reads its reason after "dimmed".
  useEffect(() => {
    const target = shown?.target
    if (!target) return
    target.setAttribute('aria-describedby', TIP_ID)
    return () => target.removeAttribute('aria-describedby')
  }, [shown?.target])

  // Place the tip once it is drawn and its size is known; again when the window moves under it.
  useLayoutEffect(() => {
    if (!shown) {
      setAt(null)
      return
    }
    const place = () => {
      const box = tipRef.current
      if (!box) return
      const r = shown.target.getBoundingClientRect()
      const t = box.getBoundingClientRect()
      const p = tipPlace(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        { width: t.width, height: t.height },
        { width: window.innerWidth, height: window.innerHeight },
        GAP,
      )
      setAt({ left: p.left, top: p.top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [shown])

  if (!shown) return null
  return createPortal(
    <div
      ref={tipRef}
      id={TIP_ID}
      className="why-tip small"
      role="tooltip"
      style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {shown.text}
    </div>,
    document.body,
  )
}
