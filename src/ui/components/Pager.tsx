import { useEffect, useRef } from 'react'
import { pagerStep } from '../pager'

/** Where a step goes: the neighbour's name for the hover, and its page. */
export interface PagerStep {
  name: string
  href: string
}

/** What the control shows: the item's place in its list and its two neighbours (null at an end). */
export interface PagerProps {
  place: { position: number; count: number }
  previous: PagerStep | null
  next: PagerStep | null
  /** False on a page whose arrow keys belong to something else (an image page's takes): buttons only. */
  keys?: boolean
}

/** The button a press went from, kept for the page it opens, so focus can stay on that button. */
let pending: { side: 'previous' | 'next'; href: string; at: number } | null = null

/** How long a press may wait for its page to open before it is forgotten. */
const PENDING_MS = 3000

/**
 * The previous/next control at the right end of a one-item page's header: ‹ and › around "3 of 12",
 * and the arrow keys when focus is not in a field or a control that uses them. A step moves the
 * address, as the breadcrumb does, so whatever asks before leaving a page asks the same here.
 */
export function Pager({ place, previous, next, keys = true }: PagerProps) {
  const buttons = useRef<Record<'previous' | 'next', HTMLButtonElement | null>>({
    previous: null,
    next: null,
  })
  const go = (side: 'previous' | 'next', step: PagerStep | null, byButton: boolean) => {
    if (!step) return
    if (byButton) pending = { side, href: step.href, at: Date.now() }
    window.location.hash = step.href
  }
  // The page opened by a press of a button: focus the same button, greyed out or not.
  useEffect(() => {
    const kept = pending
    pending = null
    if (kept && kept.href === window.location.hash && Date.now() - kept.at < PENDING_MS) {
      buttons.current[kept.side]?.focus()
    }
  }, [])
  const latest = useRef({ previous, next })
  latest.current = { previous, next }
  useEffect(() => {
    if (!keys) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (event.defaultPrevented || !(target instanceof Element)) return
      const way = pagerStep({
        key: event.key,
        modifier: event.metaKey || event.ctrlKey || event.altKey,
        target: {
          tagName: target.tagName,
          isContentEditable: (target as HTMLElement).isContentEditable,
          closest: (selector) => target.closest(selector),
        },
      })
      if (way === null) return
      event.preventDefault()
      const side = way < 0 ? 'previous' : 'next'
      go(side, latest.current[side], false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [keys])
  const button = (side: 'previous' | 'next', step: PagerStep | null) => {
    const label = step
      ? `${side === 'previous' ? 'Previous' : 'Next'}: ${step.name}`
      : side === 'previous'
        ? 'This is the first'
        : 'This is the last'
    return (
      <button
        ref={(element) => {
          buttons.current[side] = element
        }}
        className="btn pager-btn"
        type="button"
        title={step && keys ? `${label} (${side === 'previous' ? '←' : '→'})` : label}
        aria-label={label}
        aria-disabled={step ? undefined : 'true'}
        onClick={() => go(side, step, true)}
      >
        {side === 'previous' ? '‹' : '›'}
      </button>
    )
  }
  return (
    <div className="pager">
      {button('previous', previous)}
      <span className="pager-count">
        {place.position} of {place.count}
      </span>
      {button('next', next)}
    </div>
  )
}
