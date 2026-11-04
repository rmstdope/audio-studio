import { useEffect, useRef, type FocusEvent } from 'react'

/**
 * Keeps a keyboard user's place when a Stop all button goes away. Spread the result on the button;
 * when `busy` ends (the stop worked, or the takes finished on their own) while focus was on that
 * button, `land` is called once to put focus where the panel's next state wants it. Focus anywhere
 * else is never touched. A blur only counts while the button is still on the page, since removing a
 * focused button must not look like leaving it.
 */
export function useStopFocus(busy: boolean, land: () => void) {
  const held = useRef(false)
  const was = useRef(busy)
  useEffect(() => {
    if (was.current && !busy && held.current) land()
    if (!busy) held.current = false
    was.current = busy
  })
  return {
    onFocus: () => {
      held.current = true
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.isConnected) held.current = false
    },
  }
}
