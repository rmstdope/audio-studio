import type { KeyboardEvent } from 'react'

/**
 * The handlers that tell whether a menu's list is probably open, for a menu whose closed text is
 * shorter than its entries: a click or a key that opens it, and Escape or leaving that closes it.
 */
export function openTracking(setOpen: (open: boolean) => void) {
  return {
    onMouseDown: () => setOpen(true),
    onKeyDown: (event: KeyboardEvent<HTMLSelectElement>) => {
      if (event.key === 'Escape') setOpen(false)
      else if (
        [' ', 'Enter', 'F4', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
        // Alt+Arrow opens the list everywhere; a bare arrow does on macOS.
        (event.key.startsWith('Arrow') || !event.altKey)
      )
        setOpen(true)
    },
    onBlur: () => setOpen(false),
  }
}
