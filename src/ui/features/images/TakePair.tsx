import { useEffect, useRef, useState } from 'react'
import type { ImageRow } from '../../../core/images'
import type { ImageTakeView } from '../../../core/imageTakes'
import { lookZoom, modelCaption } from '../../imagesText'

/** The space between the two pictures, in pixels (the stylesheet's `.look-pair` gap). */
const GAP = 10

/** A short stable tag of some text, to tell a picture's address from its address under another look. */
function tag(text: string): string {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash.toString(36)
}

/**
 * A take's two pictures: what the model made on the left and what the game gets on the right, the
 * game's version enlarged by the largest whole number at which both fit, with crisp pixels; they
 * stack, in the same order, when the window is too narrow. `current` shows the picture the game
 * has now instead of the take's own game version (the chosen take, whose version the game may
 * still have under an old look). The right side says so while the take is being brought to the
 * look, and says what to fix when the style file cannot be used.
 */
export function TakePair({
  id,
  take,
  row,
  lookError,
  current = false,
}: {
  id: string
  take: ImageTakeView
  row: ImageRow
  lookError: string | null
  current?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => setAvailable(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const { zoom, stacked } = lookZoom(available, GAP, row.width)
  const shown = { width: row.width * zoom, height: row.height * zoom }
  const base = `/api/images/${encodeURIComponent(id)}`
  const version = tag(`${row.look.key ?? ''}${take.look}${row.looksOld}`)
  const gameSrc = current
    ? `${base}/current?v=${version}`
    : `${base}/takes/${take.n}/game?v=${version}`
  const state = current
    ? 'ready'
    : lookError
      ? 'error'
      : take.look === 'bringing' || take.look === 'missing'
        ? take.look
        : 'ready'
  return (
    <div className="look-pair" data-stacked={stacked} ref={box}>
      <div className="look-side">
        <span className="lbl">What the model made</span>
        <img
          className="image-take-picture"
          src={`${base}/takes/${take.n}`}
          alt={`Take ${take.n}, what the model made`}
          style={{ width: shown.width, aspectRatio: `${take.width} / ${take.height}` }}
        />
        <span className="faint small">{modelCaption(take.width, take.height, take.cropped)}</span>
      </div>
      <div className="look-side">
        <span className="lbl">What the game gets</span>
        {state === 'ready' ? (
          <img
            className="image-take-picture"
            src={gameSrc}
            alt={`Take ${take.n}, what the game gets`}
            style={{ width: shown.width, aspectRatio: `${row.width} / ${row.height}` }}
          />
        ) : (
          <div
            className={`look-empty${state === 'error' ? ' look-empty-err' : ''}`}
            style={{ width: shown.width, aspectRatio: `${row.width} / ${row.height}` }}
            role={state === 'error' ? 'alert' : 'status'}
          >
            {state === 'error'
              ? lookError
              : state === 'missing'
                ? "Not brought to the game's look yet."
                : "Bringing to the game's look…"}
          </div>
        )}
        <span className="faint small">
          {state === 'bringing' || state === 'missing' ? '' : `${row.width} × ${row.height}`}
        </span>
      </div>
    </div>
  )
}
