import type { ReactNode } from 'react'

/**
 * A model menu whose closed text wraps: the words are drawn in a box that grows to as many lines
 * as it needs, and the native select (the child) lies over it, invisible, so pressing it opens
 * the computer's own list and Tab, the arrow keys and the disabled state are the select's.
 */
export function MenuFace({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="menu-face">
      {text}
      {children}
    </span>
  )
}
