import { useEffect, useRef, useState } from 'react'
import { useStopFocus } from './useStopFocus'

/** Where focus goes once the panel has re-rendered after a press. */
type Target = 'button' | 'make' | 'stop' | 'close'

/**
 * What every Make-all panel (music, images, sound effects) does with its question and its focus:
 * the question (`open`) gives way when takes start and does not come back; focus moves after the
 * render that shows its target (`goTo`); Stop all, going away under a keyboard user, hands focus on
 * to Close, the Make button or the panel; Close (`closed`) hands focus back to the Make button once
 * the summary has gone. The panel puts `panel`, `button`, `makeButton`, `stopButton` and
 * `closeButton` on its elements and spreads `stopFocus` on Stop all.
 *
 * `busy`: takes of the list are being made. `summary`: the end-of-batch summary is drawn.
 * `settled`: the batch is over, so a wish to focus Stop all is dropped. `resetStop`: clears the
 * last Stop all failure once nothing is being made. `fallback`: the element to focus when the
 * panel itself is not one (a panel whose frame is drawn by its page).
 */
export function useMakeAllPanel({
  busy,
  summary,
  settled,
  resetStop,
  fallback,
}: {
  busy: boolean
  summary: boolean
  settled: boolean
  resetStop: () => void
  fallback?: () => HTMLElement | null
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<Target | null>(null)
  const closing = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const makeButton = useRef<HTMLButtonElement>(null)
  const stopButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!target) return
    // After Close the summary may still be drawn for a moment; focus waits for what replaces it.
    if (target === 'button' && closing.current && summary) return
    const element = { button, make: makeButton, stop: stopButton, close: closeButton }[target]
      .current
    if (!element && target === 'stop' && !settled) return // Stop all is not drawn yet
    if (element) element.focus()
    else if (target === 'button') (panel.current ?? fallback?.())?.focus()
    closing.current = false
    setTarget(null)
  }, [target, summary, settled, busy])
  const stopFocus = useStopFocus(busy, () => {
    if (closeButton.current) closeButton.current.focus()
    else if (button.current) button.current.focus()
    else (panel.current ?? fallback?.())?.focus()
  })
  useEffect(() => {
    if (!busy) resetStop()
  }, [busy, resetStop])
  useEffect(() => {
    if (busy) setOpen(false)
  }, [busy])
  return {
    open,
    setOpen,
    /** Moves focus to `to` once it is drawn. */
    goTo: setTarget,
    /** Close was pressed: focus returns to the Make button after the summary has gone. */
    closed: () => {
      closing.current = true
      setTarget('button')
    },
    stopFocus,
    panel,
    button,
    makeButton,
    stopButton,
    closeButton,
  }
}
