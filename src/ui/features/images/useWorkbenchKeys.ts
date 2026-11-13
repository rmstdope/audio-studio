import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'

/** The inputs that are pressed rather than typed into (a take's box): the tab keys still work there. */
export const PRESSED_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset'])

/**
 * Whether the target is a field that owns the keys typed into it: a text area, a menu, or an input
 * that is typed into. A box or a button leaves them to the page.
 */
export function fieldOwnsKeys(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && !PRESSED_INPUTS.has(target.type))
  )
}

/** Whether a key pressed on `target` is typing in a field or choosing in a menu. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLInputElement && PRESSED_INPUTS.has(target.type)) return false
  return (
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="listbox"]',
    ) !== null
  )
}

/**
 * The keys of an image workbench, heard anywhere on the page while `active`. Put the handler on the
 * returned ref in the render body: the latest render's handler is the one that hears the key, so it
 * always sees the current state.
 */
export function useDocumentKeys(active = true): MutableRefObject<(event: KeyboardEvent) => void> {
  const handler = useRef<(event: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    if (!active) return
    const listen = (event: KeyboardEvent) => handler.current(event)
    document.addEventListener('keydown', listen)
    return () => document.removeEventListener('keydown', listen)
  }, [active])
  return handler
}

/**
 * Focus asked for now and given once the change has settled: `focusOn(want)` names where, and after
 * the render `resolve` finds the element. It is tried once and given up on when the element is null;
 * an `undefined` answer waits for the page to show it (checked again after each render that changes
 * `rerunOn`). A `quietly` focus does not scroll: a mouse press stays where it was.
 */
export function usePendingFocus<Want>(
  resolve: (want: Want) => HTMLElement | null | undefined,
  rerunOn?: unknown,
): (want: Want, quietly?: boolean) => void {
  const [pending, setPending] = useState<{ want: Want } | null>(null)
  const quietly = useRef(false)
  useEffect(() => {
    if (pending === null) return
    const target = resolve(pending.want)
    if (target === undefined) return
    target?.focus(quietly.current ? { preventScroll: true } : undefined)
    quietly.current = false
    setPending(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, rerunOn])
  return useCallback((want, quiet = false) => {
    quietly.current = quiet
    setPending({ want })
  }, [])
}
