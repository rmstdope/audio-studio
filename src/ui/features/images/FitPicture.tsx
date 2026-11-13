import type { CSSProperties, ReactNode } from 'react'

/**
 * The style that gives a picture its shape for the stylesheet: the `aspect-ratio`, and the same
 * ratio as a number (`--picture-ratio`), which the stylesheet needs to size the picture by the room
 * its track gives it. Every image page's picture takes it from here.
 */
export function pictureShape(width: number, height: number): CSSProperties {
  return { aspectRatio: `${width} / ${height}`, '--picture-ratio': width / height } as CSSProperties
}

/**
 * The track a picture sits in: the room its page's layout leaves it, which a picture with the
 * `fit-shape` class takes as much of as its shape allows (`.fit-picture` in the stylesheet). No page
 * names the pixels above and below it (as-5wln).
 */
export function FitPicture({ children }: { children: ReactNode }) {
  return <div className="fit-picture">{children}</div>
}
