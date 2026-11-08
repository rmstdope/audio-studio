import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { AreaBox, AreaRow, ImageRow } from '../../../core/images'
import { useImagePatches, useSetImageAreaBox } from '../../api'
import {
  HANDLES,
  boxFromDrag,
  moveBox,
  nudgeBox,
  pointOnPicture,
  resizeBox,
  smallestAt,
  type Handle,
  type Point,
} from '../../imageAreaBox'
import {
  areaLineText,
  areaSaveFailedText,
  areaTagText,
  areasCountText,
  placeAgainLine,
} from '../../imagesText'

/** A patch with a chosen take on the image's take, which can be laid over the picture for looking. */
interface ChosenPatch {
  id: string
  title: string
  /** Where the patch's picture is. */
  src: string
}

/** The patches that have a chosen take, in the game's order, with where each take's picture is. */
function chosenPatchesOf(
  row: ImageRow,
  view: ReturnType<typeof useImagePatches>['data'],
): ChosenPatch[] {
  if (!view || !('patches' in view)) return []
  return row.patches.flatMap((patch) => {
    const take = view.patches.find((p) => p.id === patch.id)?.takes.find((t) => t.chosen)
    if (!take) return []
    const src = `/api/images/${encodeURIComponent(row.id)}/patches/${encodeURIComponent(patch.id)}/takes/${take.n}`
    return [{ id: patch.id, title: patch.title, src }]
  })
}

/** How far, in screen pixels, a press may move and still be a click. */
const CLICK_SLACK = 3

/** What a drag on the picture is doing. */
interface Gesture {
  mode: 'draw' | 'move' | 'resize'
  /** The area it changes. */
  area: string
  start: Point
  /** Where it went down on the screen: a click is a press that stays within a few screen pixels. */
  screen: Point
  /** The box a move or resize began from. */
  origin: AreaBox | null
  handle?: Handle
  /** The box as it would be if let go now; null while it is too small to be one. */
  preview: AreaBox | null
  /** The pointer has left the image pixel it went down on. */
  moved: boolean
  /** What a click, a drag too small to be a box, would select. */
  clicked: string | null
}

/** Whether two boxes are the same. */
function same(a: AreaBox | null, b: AreaBox | null): boolean {
  return (
    a === b ||
    (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
  )
}

/** A box as the percentages of the picture it is drawn with. */
function placedStyle(box: AreaBox, row: { width: number; height: number }) {
  return {
    left: `${(box.x / row.width) * 100}%`,
    top: `${(box.y / row.height) * 100}%`,
    width: `${(box.width / row.width) * 100}%`,
    height: `${(box.height / row.height) * 100}%`,
  }
}

/**
 * The named areas the game wants placed on an image, marked on its chosen take: the picture beside
 * the list of areas. One area is selected at a time; dragging on the picture draws its box, a drag
 * inside it moves it, on a handle resizes it, and the arrow keys nudge it. Every change is saved as
 * it is made, shown at once and taken back if saving fails. Nothing here reaches the game. Nothing
 * on the page when the game names none. The patches chosen on the image's take can be laid over
 * the picture for looking.
 */
export function NamedAreasPanel({ row }: { row: ImageRow }) {
  const picture = useImagePatches(row.id).data
  const chosenPatches = chosenPatchesOf(row, picture)
  const save = useSetImageAreaBox(row.id)
  const [selected, select] = useState<string | null>(
    () => row.areas.find((area) => !area.placed)?.id ?? null,
  )
  const [gesture, setGesture] = useState<Gesture | null>(null)
  // Boxes asked for and not yet seen in the row, by area; null is a clear.
  const [pending, setPending] = useState<Record<string, AreaBox | null>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [unreadable, setUnreadable] = useState<number | null>(null)
  const [shown, setShown] = useState<Set<string>>(new Set())
  const stage = useRef<HTMLDivElement>(null)
  const rowButtons = useRef<Record<string, HTMLButtonElement | null>>({})
  const size = { width: row.width, height: row.height }

  // A pending box is settled once the row carries it.
  useEffect(() => {
    setPending((now) => {
      const left = Object.entries(now).filter(
        ([id, box]) => !same(box, row.areas.find((a) => a.id === id)?.box ?? null),
      )
      return left.length === Object.keys(now).length ? now : Object.fromEntries(left)
    })
  }, [row.areas])

  // A new take in the game: the first area still needing a place is selected, as on arrival.
  const taken = useRef(row.chosenTake)
  useEffect(() => {
    if (taken.current === row.chosenTake) return
    taken.current = row.chosenTake
    select(row.areas.find((area) => !area.placed)?.id ?? null)
  }, [row.chosenTake, row.areas])

  // Esc cancels a drag in progress.
  useEffect(() => {
    if (!gesture) return
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setGesture(null)
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [gesture])

  if (row.areas.length === 0) return null

  const areas: AreaRow[] = row.areas.map((area) => {
    const box = area.id in pending ? pending[area.id]! : area.box
    return { ...area, placed: box !== null, box }
  })
  const placedCount = areas.filter((area) => area.placed).length
  // The areas placed on another take and not on the one in the game, and the takes still there.
  const again = areas.filter((a) => !a.placed && (a.elsewhere.length > 0 || a.elsewhereGone))
  const againTakes = [...new Set(again.flatMap((a) => a.elsewhere))].sort((a, b) => a - b)
  const current = areas.find((area) => area.id === selected) ?? null

  const view = picture && 'patches' in picture ? picture : null
  const state = !picture
    ? 'loading'
    : !view
      ? 'gone'
      : view.pictureGone || unreadable === view.take?.n
        ? 'gone'
        : view.take
          ? 'ready'
          : 'none'
  const ready = state === 'ready' && !!view?.take

  /** Sends a box (or a clear) to be saved, showing it at once and taking it back if it fails. */
  const commit = (area: AreaRow, box: AreaBox | null) => {
    setPending((now) => ({ ...now, [area.id]: box }))
    const undo = (reason: string) => {
      setPending((now) => {
        if (now[area.id] !== box) return now
        const { [area.id]: _gone, ...rest } = now
        return rest
      })
      setFailure(areaSaveFailedText(area.title, reason))
    }
    save.mutate(
      { area: area.id, box },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setFailure(null)
            return
          }
          undo(result.problems[0]?.message ?? 'the studio could not save it')
        },
        onError: (error) => undo(error.message),
      },
    )
  }

  const focusRow = (id: string) => requestAnimationFrame(() => rowButtons.current[id]?.focus())

  const screenOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY })

  const pointAt = (event: PointerEvent) =>
    pointOnPicture(
      { x: event.clientX, y: event.clientY },
      stage.current!.getBoundingClientRect(),
      size,
    )

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.ctrlKey || !ready) return
    event.preventDefault()
    const at = pointAt(event)
    const handle = (event.target as HTMLElement).dataset?.handle as Handle | undefined
    const boxes = areas.flatMap((a) => (a.box ? [{ id: a.id, box: a.box }] : []))
    const tagged = (event.target as HTMLElement).closest?.('[data-tag-of]')
    const clicked = tagged?.getAttribute('data-tag-of') ?? smallestAt(boxes, at)
    let next: Gesture | null = null
    if (current && current.box && handle) {
      next = {
        mode: 'resize',
        area: current.id,
        start: at,
        screen: { x: event.clientX, y: event.clientY },
        origin: current.box,
        handle,
        preview: current.box,
        moved: false,
        clicked: null,
      }
    } else if (current && current.box && smallestAt([{ id: current.id, box: current.box }], at)) {
      next = {
        mode: 'move',
        area: current.id,
        start: at,
        screen: { x: event.clientX, y: event.clientY },
        origin: current.box,
        preview: current.box,
        moved: false,
        clicked,
      }
    } else if (current) {
      next = {
        mode: 'draw',
        area: current.id,
        start: at,
        screen: { x: event.clientX, y: event.clientY },
        origin: null,
        preview: null,
        moved: false,
        clicked,
      }
    } else if (clicked) {
      select(clicked)
      return
    }
    if (!next) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setGesture(next)
  }

  const preview = (g: Gesture, at: Point, screen: Point): Gesture => {
    const moved = g.moved || Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y) >= CLICK_SLACK
    if (!moved) return g
    if (g.mode === 'draw') return { ...g, moved, preview: boxFromDrag(g.start, at) }
    if (g.mode === 'move') {
      return { ...g, moved, preview: moveBox(g.origin!, at.x - g.start.x, at.y - g.start.y, size) }
    }
    return { ...g, moved, preview: resizeBox(g.origin!, g.handle!, at) }
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture) setGesture(preview(gesture, pointAt(event), screenOf(event)))
  }

  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!gesture) return
    const done = preview(gesture, pointAt(event), screenOf(event))
    setGesture(null)
    const area = areas.find((a) => a.id === done.area)
    if (!area) return
    if (done.preview && done.moved && !same(done.preview, done.origin)) {
      commit(area, done.preview)
      focusRow(area.id)
    } else if (done.clicked && done.clicked !== done.area) {
      select(done.clicked)
      focusRow(done.clicked)
    } else if (done.clicked) {
      focusRow(done.clicked)
    }
  }

  const keys = (event: KeyboardEvent<HTMLElement>, area: AreaRow) => {
    if (area.id !== selected || !area.box) return
    if (event.target !== rowButtons.current[area.id]) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      commit(area, null)
      return
    }
    const next = nudgeBox(area.box, event.key, event.shiftKey, size)
    if (!next) return
    event.preventDefault()
    if (!same(next, area.box)) commit(area, next)
  }

  const boxes = areas.flatMap((area) => {
    const live = gesture?.area === area.id && gesture.mode !== 'draw' ? gesture.preview : null
    const box = live ?? area.box
    return box ? [{ area, box }] : []
  })
  const drawing = gesture?.mode === 'draw' ? gesture.preview : null
  const ordered = [
    ...boxes.filter((b) => b.area.id !== selected),
    ...boxes.filter((b) => b.area.id === selected),
  ]

  return (
    <section className="panel named-areas" aria-label="Named areas">
      <div className="brief-panel-head named-areas-head">
        <h2>Named areas</h2>
        <span className="muted">{areasCountText(placedCount, areas.length)}</span>
      </div>
      <p className="muted named-areas-intro">
        The parts of this picture the game names, so that a player can click them.
      </p>
      {failure && (
        <p className="adopt-error" role="alert">
          {failure}
        </p>
      )}
      <div className="named-areas-body">
        <div className="named-areas-picture">
          {ready && view?.take ? (
            <>
              <div
                ref={stage}
                className="named-area-stage"
                style={{ aspectRatio: `${row.width} / ${row.height}` }}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => setGesture(null)}
              >
                <img
                  className="named-area-take"
                  src={`/api/images/${encodeURIComponent(row.id)}/takes/${view.take.n}`}
                  alt="The chosen take"
                  draggable={false}
                  onError={() => setUnreadable(view.take?.n ?? null)}
                />
                {chosenPatches
                  .filter((patch) => shown.has(patch.id))
                  .map((patch) => (
                    <img
                      key={patch.id}
                      className="named-area-take named-area-patch"
                      src={patch.src}
                      alt={patch.title}
                      draggable={false}
                    />
                  ))}
                {ordered.map(({ area, box }) => {
                  const isSelected = area.id === selected
                  const edge = [
                    box.y / row.height < 0.08 ? ' low' : '',
                    box.x / row.width > 0.5 ? ' right' : '',
                  ].join('')
                  return (
                    <div
                      key={area.id}
                      className={`named-area-box${isSelected ? ' selected' : ''}${edge}`}
                      style={placedStyle(box, row)}
                      data-area={area.id}
                    >
                      <span title={area.title} data-tag-of={area.id}>
                        {areaTagText(area.title)}
                      </span>
                      {isSelected &&
                        HANDLES.map((handle) => (
                          <i
                            key={handle}
                            className={`handle handle-${handle}`}
                            data-handle={handle}
                          />
                        ))}
                    </div>
                  )
                })}
                {drawing && (
                  <div className="named-area-box drawing" style={placedStyle(drawing, row)} />
                )}
              </div>
              <p className="muted named-area-line">{areaLineText(current)}</p>
            </>
          ) : (
            <div
              className={`named-area-empty${state === 'loading' ? '' : ' named-area-empty-text'}`}
              style={{ aspectRatio: `${row.width} / ${row.height}` }}
              role={state === 'loading' ? undefined : 'status'}
            >
              {state === 'none' && 'Choose a take to mark the areas on it.'}
              {state === 'gone' &&
                "The chosen take's picture is missing or cannot be read, so the areas cannot be marked on it."}
            </div>
          )}
        </div>
        {again.length > 0 && (
          <p className="place-again-line">
            {placeAgainLine(againTakes, row.chosenTake, again.length)}
          </p>
        )}
        <ul className="named-area-list">
          {areas.map((area) => {
            const isSelected = ready && area.id === selected
            return (
              <li
                key={area.id}
                className={`named-area${isSelected ? ' selected' : ''}`}
                onKeyDown={(event) => keys(event, area)}
              >
                <button
                  type="button"
                  className="named-area-main"
                  ref={(el) => {
                    rowButtons.current[area.id] = el
                  }}
                  disabled={!ready}
                  aria-pressed={isSelected}
                  onClick={() => select(area.id)}
                >
                  <span className="named-area-text">
                    <b>{area.title}</b>
                    <span className="mono muted">{area.id}</span>
                  </span>
                </button>
                {isSelected && area.placed && (
                  <button
                    type="button"
                    className="btn named-area-clear"
                    onClick={() => {
                      commit(area, null)
                      focusRow(area.id)
                    }}
                  >
                    Clear
                  </button>
                )}
                {area.placed ? (
                  <span className="chip chip-ok">Placed</span>
                ) : area.elsewhere.length > 0 || area.elsewhereGone ? (
                  <span className="chip chip-attention">Place again</span>
                ) : (
                  <span className="chip chip-attention">To place</span>
                )}
              </li>
            )
          })}
        </ul>
        {ready && chosenPatches.length > 0 && (
          <div className="named-area-switches">
            <span className="muted">Show on the picture:</span>
            {chosenPatches.map((patch) => (
              <label key={patch.id} className="named-area-switch">
                <input
                  type="checkbox"
                  checked={shown.has(patch.id)}
                  onChange={(event) =>
                    setShown((now) => {
                      const next = new Set(now)
                      if (event.target.checked) next.add(patch.id)
                      else next.delete(patch.id)
                      return next
                    })
                  }
                />
                {patch.title}
              </label>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
