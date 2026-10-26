import { useEffect, useRef, type RefObject } from 'react'

/**
 * Gives focus back to the button that opened something (a box, a form) once it has closed. The
 * button is often disabled while it is open, so focusing it in the same handler that closes it
 * does nothing; this focuses it after the page has been drawn without it. Returns the function to
 * call when closing; a close that should leave focus where it goes (a page change) does not call it.
 */
export function useFocusWhenClosed(open: boolean, opener: RefObject<HTMLElement | null>) {
  const pending = useRef(false)
  useEffect(() => {
    if (open || !pending.current) return
    pending.current = false
    opener.current?.focus()
  }, [open, opener])
  return () => {
    pending.current = true
  }
}
