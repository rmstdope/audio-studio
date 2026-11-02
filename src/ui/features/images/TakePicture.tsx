import type { ImageRow } from '../../../core/images'
import type { ImageTakeView } from '../../../core/imageTakes'
import { modelCaption } from '../../imagesText'

/** Which of a take's pictures the Takes section shows: what the model made, or what the game gets. */
export type Showing = 'model' | 'game'

/** A short stable tag of some text, to tell a picture's address from its address under another look. */
function tag(text: string): string {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash.toString(36)
}

/**
 * Where a take's game's version is, or null while it has none to show (being brought to the look,
 * never brought to it, or the style file cannot be used). The look and the count of saved choices
 * are in the address: the picture at it changes with them, and a browser keeps what it loaded at an
 * address. `current` is the picture the game has now, for the chosen take.
 */
export function gameSource(
  id: string,
  take: ImageTakeView,
  row: ImageRow,
  lookError: string | null,
  current = false,
  saved = 0,
): string | null {
  const base = `/api/images/${encodeURIComponent(id)}`
  const version = tag(`${row.look.key ?? ''}${take.look}${row.looksOld}${take.n}/${saved}`)
  if (current) return `${base}/current?v=${version}`
  if (lookError || take.look === 'bringing' || take.look === 'missing') return null
  return `${base}/takes/${take.n}/game?v=${version}`
}

/** Where a take's own picture, what the model made, is. */
export function modelSource(id: string, take: ImageTakeView): string {
  return `/api/images/${encodeURIComponent(id)}/takes/${take.n}`
}

/**
 * A take's one picture, what the model made or what the game gets as `showing` says, `zoom` times
 * the game's size, with crisp pixels. `current` shows the picture the game has now instead of the
 * take's own game version (the chosen take, whose version the game may still have under an old
 * look). In place of the game's version it says so while the take is being brought to the look, and
 * says what to fix when the style file cannot be used. While the choice of the take shown as
 * `current` is still being saved the game has no such picture yet, so none is asked for.
 */
export function TakePicture({
  id,
  take,
  row,
  lookError,
  showing,
  zoom,
  current = false,
  saving = false,
  saved = 0,
}: {
  id: string
  take: ImageTakeView
  row: ImageRow
  lookError: string | null
  showing: Showing
  zoom: number
  current?: boolean
  saving?: boolean
  saved?: number
}) {
  const width = row.width * zoom
  if (showing === 'model') {
    return (
      <div className="look-side">
        <img
          className="image-take-picture"
          src={modelSource(id, take)}
          alt={`Take ${take.n}, what the model made`}
          style={{ width, aspectRatio: `${take.width} / ${take.height}` }}
        />
        <span className="faint small">{modelCaption(take.width, take.height, take.cropped)}</span>
      </div>
    )
  }
  const src = current && saving ? null : gameSource(id, take, row, lookError, current, saved)
  const state = src ? 'ready' : current ? 'saving' : lookError ? 'error' : take.look
  return (
    <div className="look-side">
      {src ? (
        <img
          className="image-take-picture"
          src={src}
          alt={`Take ${take.n}, what the game gets`}
          style={{ width, aspectRatio: `${row.width} / ${row.height}` }}
        />
      ) : (
        <div
          className={`look-empty${state === 'error' ? ' look-empty-err' : ''}`}
          style={{ width, aspectRatio: `${row.width} / ${row.height}` }}
          role={state === 'error' ? 'alert' : 'status'}
        >
          {state === 'error'
            ? lookError
            : state === 'saving'
              ? ''
              : state === 'missing'
                ? "Not brought to the game's look yet."
                : "Bringing to the game's look…"}
        </div>
      )}
      <span className="faint small">{src ? `${row.width} × ${row.height}` : ''}</span>
    </div>
  )
}
