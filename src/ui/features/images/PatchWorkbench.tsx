import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react'
import {
  checkPatchArea,
  type ImagePatchesView,
  type PatchArea,
  type PatchMakingView,
  type PatchTakeView,
  type PatchWorkView,
} from '../../../core/imagePatches'
import { rightAfterDrop, stepRight } from '../../../core/imageTakes'
import {
  useChoosePatchTake,
  useDropPatchTake,
  useMakePatchTakes,
  useMarkPatchTakeSeen,
  useStopPatchTakes,
  useUnchoosePatchTake,
} from '../../api'
import { Confirm } from '../../components/Confirm'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { areaFromDrag, sameArea } from '../../imagePatchArea'
import { makeTakesText, refusal, takeCountText } from '../../imagesText'
import { failureLine, progressOf, timeLeftText } from '../../musicTakesText'
import { closeUp, closeUpLayer } from '../../patchCloseUp'

/** How many takes one press can make. */
const MAX_AT_ONCE = 4

/** Where an area lies on a picture of this size, in the percentages the page draws with. */
function placed(area: PatchArea, take: { width: number; height: number }): CSSProperties {
  return {
    left: `${(area.x / take.width) * 100}%`,
    top: `${(area.y / take.height) * 100}%`,
    width: `${(area.width / take.width) * 100}%`,
    height: `${(area.height / take.height) * 100}%`,
  }
}

/** The keys a patch hears when focus is inside it. */
const PATCH_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'c', 'd', 's'])

/** A close-up of an area: the image's take with a take of the patch laid over it, only the area and a little around it. */
function CloseUp({
  imageId,
  patchId,
  take,
  n,
  area,
}: {
  imageId: string
  patchId: string
  take: { n: number; width: number; height: number }
  /** The patch take laid over the picture; none shows the picture alone (a take still to be made). */
  n: number | null
  area: PatchArea
}) {
  const crop = closeUp(area, take)
  const layer = closeUpLayer(crop, take)
  const image = encodeURIComponent(imageId)
  return (
    <span className="patch-closeup" style={{ aspectRatio: `${crop.width} / ${crop.height}` }}>
      <img src={`/api/images/${image}/takes/${take.n}`} style={layer} alt="" draggable={false} />
      {n !== null && (
        <img
          src={`/api/images/${image}/patches/${encodeURIComponent(patchId)}/takes/${n}`}
          style={layer}
          alt=""
          draggable={false}
        />
      )}
    </span>
  )
}

/** A take waiting or being made, in the grid: its place, its time and a progress bar. */
function MakingThumb({
  making,
  take,
  imageId,
  patchId,
}: {
  making: PatchMakingView
  take: { n: number; width: number; height: number }
  imageId: string
  patchId: string
}) {
  const crop = closeUp(making.area, take)
  return (
    <div className="patch-thumb patch-thumb-making">
      <span
        className="patch-closeup patch-closeup-empty"
        style={{ aspectRatio: `${crop.width} / ${crop.height}` }}
      />
      <span className="patch-thumb-label">
        <span className="grow">Take {making.n}</span>
      </span>
      <span className="faint small">{timeLeftText(making)}</span>
      <div
        className="bar"
        role="progressbar"
        aria-label={`Take ${making.n} of ${patchId} on ${imageId}`}
      >
        <i style={{ width: `${Math.round(progressOf(making) * 100)}%` }} />
      </div>
    </div>
  )
}

/**
 * An open patch: the image's chosen take as one large picture to mark and to lay the patch's
 * takes over, and beside it the patch's words, Make controls and takes. The mark is the page's,
 * kept by the caller so that it outlives closing the row. Without a picture to patch it is only
 * the words and a line saying why.
 */
export function PatchWorkbench({
  imageId,
  patchId,
  view,
  work,
  words,
  mark,
  onMark,
}: {
  imageId: string
  patchId: string
  view: ImagePatchesView
  work: PatchWorkView
  /** The patch's field of words. */
  words: ReactNode
  mark: PatchArea | null
  onMark: (area: PatchArea) => void
}) {
  const make = useMakePatchTakes(imageId, patchId)
  const stop = useStopPatchTakes(imageId, patchId)
  const choose = useChoosePatchTake(imageId, patchId)
  const drop = useDropPatchTake(imageId, patchId)
  const unchoose = useUnchoosePatchTake(imageId, patchId)
  const seen = useMarkPatchTakeSeen(imageId, patchId)
  const [looking, setLooking] = useState<number | null>(null)
  const [showing, setShowing] = useState(true)
  const [count, setCount] = useState(2)
  const [asking, setAsking] = useState(false)
  const [pendingFocus, setPendingFocus] = useState<number | 'heading' | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const asked = useRef(new Set<number>())
  // Focus asked for by a press of Make does not scroll: a mouse press stays where it was.
  const focusQuietly = useRef(false)
  // A choice or drop asked for by a key and not yet settled: a second press waits for it.
  const changing = useRef(false)
  const heading = useRef<HTMLSpanElement>(null)
  const unchooseButton = useRef<HTMLButtonElement>(null)
  const thumbs = useRef(new Map<number, HTMLButtonElement>())
  const refocusUnchoose = useFocusWhenClosed(asking, unchooseButton)

  const { take } = view
  const { takes, making, failed } = work
  const strip = takes.map((t) => t.n)
  const fallback = (takes.find((t) => t.chosen) ?? takes.at(-1))?.n ?? null
  const lookingAt = looking !== null && strip.includes(looking) ? looking : fallback
  const shown = takes.find((t) => t.n === lookingAt) ?? null

  // Looking stays where it is put: it is pinned to the first take there is, and moves only when
  // its take leaves the grid.
  useEffect(() => {
    if (lookingAt !== looking) setLooking(lookingAt)
  })
  // A take laid over the picture once is no longer "new".
  useEffect(() => {
    if (shown?.isNew && !asked.current.has(shown.n)) {
      asked.current.add(shown.n)
      seen.mutate(shown.n)
    }
  })
  // The grid scrolls on its own: the take looked at is kept in view as ← and → step.
  useEffect(() => {
    if (lookingAt !== null) thumbs.current.get(lookingAt)?.scrollIntoView?.({ block: 'nearest' })
  }, [lookingAt])
  useEffect(() => {
    if (pendingFocus === null) return
    const target = pendingFocus === 'heading' ? heading.current : thumbs.current.get(pendingFocus)
    // Asked for once the change has settled: tried once, and given up on if the target cannot take it.
    target?.focus(focusQuietly.current ? { preventScroll: true } : undefined)
    focusQuietly.current = false
    setPendingFocus(null)
  }, [pendingFocus])

  if (!take) {
    return (
      <>
        {words}
        <span className="muted small">
          {view.pictureGone
            ? "The chosen take's picture is missing or cannot be read, so it cannot be patched."
            : 'Choose a take of the image first. Patches are painted onto the take the game shows.'}
        </span>
      </>
    )
  }

  const marked = mark && !checkPatchArea(mark, take) ? mark : null
  const busy = making.length > 0
  const hasTakes = takes.length > 0 || busy
  const canMake = marked !== null && !busy && !make.isPending && view.maker.ok
  const canChange = !choose.isPending && !drop.isPending
  const overlaid = showing ? shown : null
  const showMark = marked !== null && !(overlaid && sameArea(marked, overlaid.area))
  const image = encodeURIComponent(imageId)
  const problem =
    refusal(make.data) ?? refusal(choose.data) ?? refusal(drop.data) ?? refusal(unchoose.data)
  const error = make.error ?? choose.error ?? drop.error ?? unchoose.error ?? stop.error
  const beforeChange = () => {
    for (const mutation of [make, choose, drop, unchoose]) mutation.reset()
  }

  const onChoose = (n: number) => {
    beforeChange()
    changing.current = true
    choose.mutate(n, {
      onSettled: () => {
        changing.current = false
        setPendingFocus(lookingAt ?? 'heading')
      },
    })
  }
  const onDrop = (n: number) => {
    const next = rightAfterDrop(strip, n)
    beforeChange()
    setLooking(next)
    changing.current = true
    drop.mutate(n, {
      onSettled: () => {
        changing.current = false
        setPendingFocus(next ?? 'heading')
      },
    })
  }
  const pick = (t: PatchTakeView) => {
    setLooking(t.n)
    onMark(t.area)
  }
  const dragTo = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const dragged = areaFromDrag(
      start.current,
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      take,
    )
    // A click, or a drag too small to patch, changes nothing.
    if (dragged) onMark(dragged)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target
    if (event.metaKey || event.ctrlKey || event.altKey || asking) return
    if (!PATCH_KEYS.has(event.key.toLowerCase()) && !PATCH_KEYS.has(event.key)) return
    // Keys typed into a field or menu are its own.
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement && target.type !== 'checkbox')
    )
      return
    // The image's own keys rest while focus is inside a patch.
    event.stopPropagation()
    event.preventDefault()
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const next = stepRight(strip, lookingAt, event.key === 'ArrowLeft' ? -1 : 1)
      if (next !== null) setLooking(next)
      return
    }
    const key = event.key.toLowerCase()
    if (key === 's') {
      if (shown) setShowing((on) => !on)
      return
    }
    // Held down, C and D would choose back and forth, or drop take after take.
    if (!shown || event.repeat || changing.current || !canChange) return
    if (key === 'c' && !shown.chosen) onChoose(shown.n)
    if (key === 'd' && !shown.chosen) onDrop(shown.n)
  }

  const left =
    asking && shown ? (
      <Confirm
        title={`Un-choose take ${shown.n}?`}
        effects={[]}
        note={`The game shows the image without this patch until you choose another. Take ${shown.n} stays among the takes.`}
        back="Cancel"
        backDisabled={unchoose.isPending}
        onBack={() => {
          refocusUnchoose()
          setAsking(false)
        }}
      >
        <button
          className="btn btn-primary"
          type="button"
          autoFocus
          disabled={unchoose.isPending}
          onClick={() =>
            unchoose.mutate(undefined, {
              onSuccess: (answer) => {
                if (answer.ok) setPendingFocus(lookingAt ?? 'heading')
                else refocusUnchoose()
                setAsking(false)
              },
              onError: () => {
                refocusUnchoose()
                setAsking(false)
              },
            })
          }
        >
          {unchoose.isPending ? 'Un-choosing…' : 'Un-choose'}
        </button>
      </Confirm>
    ) : (
      <>
        <div className="patch-looking">
          {shown ? (
            <>
              <span className="lbl" ref={heading} tabIndex={-1}>
                Looking at
              </span>
              <b>Take {shown.n}</b>
              {shown.chosen && <span className="chip chip-ok">Chosen</span>}
            </>
          ) : (
            <span className="lbl" ref={heading} tabIndex={-1}>
              The chosen take of the image
            </span>
          )}
        </div>
        <div
          className="patch-stage"
          style={{ aspectRatio: `${take.width} / ${take.height}` }}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.ctrlKey) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            start.current = { x: event.clientX, y: event.clientY }
          }}
          onPointerMove={dragTo}
          onPointerUp={(event) => {
            dragTo(event)
            start.current = null
          }}
          onPointerCancel={() => {
            start.current = null
          }}
        >
          <img
            className="patch-take"
            src={`/api/images/${image}/takes/${take.n}`}
            alt="The chosen take of the image"
            draggable={false}
          />
          {overlaid && (
            <img
              className="patch-over"
              src={`/api/images/${image}/patches/${encodeURIComponent(patchId)}/takes/${overlaid.n}`}
              alt={`Take ${overlaid.n}`}
              draggable={false}
            />
          )}
          {showMark && marked && <div className="patch-mark" style={placed(marked, take)} />}
        </div>
        {shown && (
          <div className="patch-controls">
            <label className="patch-toggle">
              <input
                className="patch-switch"
                type="checkbox"
                checked={showing}
                onChange={(event) => setShowing(event.target.checked)}
              />
              Show the patch
            </label>
            {shown.chosen ? (
              <button
                type="button"
                className="btn"
                ref={unchooseButton}
                disabled={!canChange}
                onClick={() => {
                  unchoose.reset()
                  setAsking(true)
                }}
              >
                Un-choose
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!canChange}
                  onClick={() => onDrop(shown.n)}
                >
                  Drop
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canChange}
                  onClick={() => onChoose(shown.n)}
                >
                  Choose
                </button>
              </>
            )}
            <span className="faint small">
              or press <kbd>D</kbd> to drop, <kbd>C</kbd> to choose, <kbd>S</kbd> to turn the patch
              off and on
            </span>
          </div>
        )}
      </>
    )

  const items = [
    ...takes.map((t) => ({ n: t.n, take: t, making: null as PatchMakingView | null })),
    ...making.map((m) => ({ n: m.n, take: null as PatchTakeView | null, making: m })),
  ].sort((a, b) => a.n - b.n)

  return (
    <div className="patch-bench" onKeyDown={onKeyDown}>
      <div className="patch-bench-left">{left}</div>
      <div className="patch-bench-right">
        {words}
        <div className="patch-make">
          <select
            className="takes-count"
            aria-label="Number of new takes"
            value={count}
            disabled={busy || make.isPending || !view.maker.ok}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {Array.from({ length: MAX_AT_ONCE }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {takeCountText(n)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canMake}
            onClick={() => {
              if (!marked) return
              // The button is off while takes are made, and the browser drops focus from it; focus
              // goes to the take looked at in the grid, so ← and → keep stepping it.
              focusQuietly.current = true
              setPendingFocus(lookingAt ?? 'heading')
              make.mutate({ count, area: marked })
            }}
          >
            {makeTakesText(count, hasTakes)}
          </button>
          {busy && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
            >
              Stop
            </button>
          )}
        </div>
        {!view.maker.ok ? (
          <span className="takes-missing small" role="status">
            {view.maker.message}
          </span>
        ) : (
          !marked && (
            <span className="muted small">Drag over the picture to mark what should change.</span>
          )
        )}
        {failed.map((f) => (
          <div className="errbox" role="alert" key={f.n}>
            <div className="errbox-text">
              <strong>Take {f.n} could not be made.</strong>
              <span className="muted small">{failureLine(f.message, takes.length > 0)}</span>
            </div>
            <button
              type="button"
              className="btn"
              disabled={make.isPending || !view.maker.ok}
              onClick={() => make.mutate({ retry: f.n })}
            >
              Try again
            </button>
          </div>
        ))}
        <div className="patch-takes">
          <h3>{takes.length === 0 ? 'Takes' : `Takes · ${takes.length}`}</h3>
          {items.length === 0 ? (
            <div className="takes-empty">
              No takes yet. Each take is a new try at this change, painted with the whole picture in
              view.
            </div>
          ) : (
            <>
              <div className="patch-thumbs">
                {items.map(({ n, take: t, making: m }) =>
                  t ? (
                    <button
                      key={n}
                      type="button"
                      className="patch-thumb"
                      aria-pressed={n === lookingAt}
                      ref={(el) => {
                        if (el) thumbs.current.set(n, el)
                        else thumbs.current.delete(n)
                      }}
                      onClick={() => pick(t)}
                    >
                      <CloseUp
                        imageId={imageId}
                        patchId={patchId}
                        take={take}
                        n={n}
                        area={t.area}
                      />
                      <span className="patch-thumb-label">
                        <span className="grow">Take {n}</span>
                        {t.chosen && <span className="chip chip-ok">Chosen</span>}
                        {t.isNew && <span className="chip chip-new">new</span>}
                        {t.earlier && <span className="faint small">earlier words</span>}
                      </span>
                    </button>
                  ) : (
                    <MakingThumb
                      key={n}
                      making={m!}
                      take={take}
                      imageId={imageId}
                      patchId={patchId}
                    />
                  ),
                )}
              </div>
              <span className="faint small">
                Press a take, or use ← →, to lay it over the picture.
              </span>
            </>
          )}
        </div>
        {problem && <span className="adopt-error">{problem}</span>}
        {error && <span className="adopt-error">{error.message}</span>}
      </div>
    </div>
  )
}
