import type { CSSProperties } from 'react'

/**
 * The style that gives a picture its shape for the stylesheet: the `aspect-ratio`, and the same
 * ratio as a number (`--picture-ratio`). Make, Fine-tune and Patches take it from here.
 */
export function pictureShape(width: number, height: number): CSSProperties {
  return { aspectRatio: `${width} / ${height}`, '--picture-ratio': width / height } as CSSProperties
}
