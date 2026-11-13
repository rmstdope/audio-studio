import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Draws a fixed-position overlay (a dialog's backdrop, a toast) straight into the document body.
 * The page's column is a query container, which makes it the containing block of anything fixed
 * inside it, so an overlay rendered in place would cover only the column and not the window.
 */
export function Overlay({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
