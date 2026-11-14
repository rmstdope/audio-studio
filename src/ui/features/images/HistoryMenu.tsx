import { useEffect, useRef, useState, type ReactNode } from 'react'
import { scrollWithin } from '../../scrollWithin'

/**
 * The History of a fine-tuned picture behind a button: "History (N) ▾" opens `children(close)`, the
 * list of steps, in a popover under it, laid over the picture. Focus moves to the step in the game
 * (the element marked `data-now`, else the first thing in the list) and the list opens scrolled to
 * it; Esc, a click outside, the button again, a step that calls `close`, another picture in the game
 * (`resetKey` changes) and the tab no longer being the open one (`active` false) close it, and
 * focus goes back to the button when the person closed it.
 */
export function HistoryMenu({
  count,
  resetKey,
  active,
  children,
}: {
  count: number
  resetKey: string
  active: boolean
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState({ resetKey, active })
  const button = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  // A new picture, or a tab put away, ends the popover before it can show a list that is not this one's.
  if (seen.resetKey !== resetKey || seen.active !== active) {
    setSeen({ resetKey, active })
    if (open) setOpen(false)
  }
  const close = () => {
    setOpen(false)
    button.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!open) return
    const now = box.current?.querySelector<HTMLElement>('[data-now="true"]')
    const first = box.current?.querySelector<HTMLElement>('button, [tabindex]')
    ;(now ?? first)?.focus({ preventScroll: true })
    scrollWithin(now, box.current)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    const onPress = (event: MouseEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        (box.current?.contains(target) || button.current?.contains(target))
      )
        return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPress)
    }
  }, [open])
  return (
    <span className="history-menu">
      <button
        ref={button}
        type="button"
        className="btn history-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {`History (${count}) ${open ? '▴' : '▾'}`}
      </button>
      {open && (
        <div ref={box} className="history-popover" role="dialog" aria-label="History">
          {children(close)}
        </div>
      )}
    </span>
  )
}
