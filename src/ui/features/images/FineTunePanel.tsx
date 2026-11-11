import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react'
import {
  cameAlongLine,
  type FineTuneFailedView,
  type FineTuneMakingView,
  type FineTuneView,
  type FineTunesView,
  type UseFineTuneAnswer,
} from '../../../core/imageFineTunes'
import {
  EDIT_SETUP_LINE,
  editModel,
  startEditModel,
  type EditModelId,
} from '../../../core/imageModels'
import type { PatchArea } from '../../../core/imagePatches'
import type { ImageRow } from '../../../core/images'
import { rightAfterDrop, stepRight } from '../../../core/imageTakes'
import { timeText } from '../../../core/takeTimes'
import {
  useDropFineTune,
  useFineTunes,
  useMakeFineTunes,
  useMarkFineTuneSeen,
  useStopFineTunes,
  useUseFineTune,
} from '../../api'
import { areaFromDrag } from '../../imagePatchArea'
import { modelMissingWhy, refusal, WAIT_FOR_CHANGE } from '../../imagesText'
import { progressOf } from '../../musicTakesText'
import { off } from '../../off'
import { EditModelMenu } from './EditModelMenu'

/** How many fine-tunes one press can make. */
const MAX_AT_ONCE = 6

/** The keys a fine-tune panel hears when focus is inside it. */
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'd', 's'])

/** Where an area lies on a picture of this size, in the percentages the page draws with. */
function placed(area: PatchArea, size: { width: number; height: number }): CSSProperties {
  return {
    left: `${(area.x / size.width) * 100}%`,
    top: `${(area.y / size.height) * 100}%`,
    width: `${(area.width / size.width) * 100}%`,
    height: `${(area.height / size.height) * 100}%`,
  }
}

/** The caption under the big picture: which picture it is. */
export function pictureCaption(picture: FineTunesView['picture']): string {
  return picture.kind === 'take'
    ? `Take ${picture.n} — the picture in the game now`
    : "The game's own image — the picture in the game now"
}

/** What a fine-tune being made says: its wait, or about how long is left. */
function leftText(making: FineTuneMakingView): string {
  if (making.state === 'waiting') return 'Waiting'
  const left = making.expected - making.elapsed
  return left <= 0 ? 'taking longer than expected' : `about ${timeText(left, 'up')} left`
}

/** The text of the box "Make fine-tunes" button: the count is in the menu beside it. */
const MAKE_LABEL = 'Make fine-tunes'

/** A fine-tune laid over the picture it was made from, as a card's picture. */
function Thumb({ base, over, size }: { base: string; over: string | null; size: PatchArea }) {
  return (
    <span className="patch-closeup" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
      {[base, over].map(
        (src) =>
          src && (
            <img
              key={src}
              src={src}
              alt=""
              draggable={false}
              style={{ left: 0, top: 0, width: '100%', height: '100%' }}
            />
          ),
      )}
    </span>
  )
}

/**
 * The panel "Fine-tune the picture" of an image: the picture in the game (the chosen take, or the
 * game's own image) as one large picture to mark and to lay fine-tunes over, the words and Make
 * controls, and the fine-tunes as cards that are used or dropped. Using one makes it the image's
 * next take, chosen.
 */
export function FineTunePanel({ row }: { row: ImageRow }) {
  const query = useFineTunes(row.id)
  const make = useMakeFineTunes(row.id)
  const stop = useStopFineTunes(row.id)
  const drop = useDropFineTune(row.id)
  const use = useUseFineTune(row.id)
  const seen = useMarkFineTuneSeen(row.id)
  const [words, setWords] = useState('')
  // The mark belongs to the picture it was dragged on; another picture has none.
  const [marked, setMarked] = useState<{ picture: string; area: PatchArea } | null>(null)
  // The model picked in the menu: not remembered past the page, so it starts on `startEditModel`.
  const [pick, setPick] = useState<EditModelId | null>(null)
  const [count, setCount] = useState(2)
  const [looking, setLooking] = useState<number | null>(null)
  const [showing, setShowing] = useState(true)
  // What a use brought along, with the picture it was made from: the line is about the picture in
  // the game then or the new take, and goes quiet when another take is chosen.
  const [came, setCame] = useState<{
    answer: Extract<UseFineTuneAnswer, { ok: true }>
    from: string
  } | null>(null)
  const [pendingFocus, setPendingFocus] = useState<number | 'words' | { stop: number } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const asked = useRef(new Set<number>())
  const changing = useRef(false)
  const wordsBox = useRef<HTMLTextAreaElement>(null)
  const cards = useRef(new Map<number, HTMLButtonElement>())
  const stops = useRef(new Map<number, HTMLButtonElement>())

  const view = query.data && 'picture' in query.data ? query.data : null
  const tunes = view?.tunes ?? []
  const strip = tunes.map((t) => t.n)
  const fallback = tunes.at(-1)?.n ?? null
  const lookingAt = looking !== null && strip.includes(looking) ? looking : fallback
  const shown = tunes.find((t) => t.n === lookingAt) ?? null

  useEffect(() => {
    if (lookingAt !== looking) setLooking(lookingAt)
  })
  // A fine-tune laid over the picture once is no longer "new".
  useEffect(() => {
    if (shown?.isNew && !asked.current.has(shown.n)) {
      asked.current.add(shown.n)
      seen.mutate(shown.n)
    }
  })
  useEffect(() => {
    if (lookingAt !== null) cards.current.get(lookingAt)?.scrollIntoView?.({ block: 'nearest' })
  }, [lookingAt])
  // The words box grows with its words, so none are out of view; a height dragged taller stays.
  useLayoutEffect(() => {
    const box = wordsBox.current
    if (!box) return
    if (words === '') {
      box.style.height = ''
      return
    }
    if (box.scrollHeight > box.clientHeight)
      box.style.height = `${box.scrollHeight + (box.offsetHeight - box.clientHeight)}px`
  }, [words, view?.picture.kind])
  useEffect(() => {
    if (pendingFocus === null) return
    const target =
      pendingFocus === 'words'
        ? wordsBox.current
        : typeof pendingFocus === 'number'
          ? cards.current.get(pendingFocus)
          : stops.current.get(pendingFocus.stop)
    // A Stop that is not there yet waits for the page to show the next fine-tune being made.
    if (!target && typeof pendingFocus === 'object') return
    target?.focus()
    setPendingFocus(null)
  }, [pendingFocus, query.data])

  // Another take chosen in Takes ends the line about the last use (not the new take it made).
  const shownKey = !view
    ? null
    : view.picture.kind === 'take'
      ? `take-${view.picture.n}`
      : view.picture.kind === 'game'
        ? 'game'
        : 'none'
  const cameHere =
    came && (shownKey === null || shownKey === came.from || shownKey === `take-${came.answer.take}`)
      ? came.answer
      : null
  if (came && !cameHere) setCame(null)
  const heading = (
    <div className="brief-panel-head">
      <h2>Fine-tune the picture</h2>
    </div>
  )
  if (!view)
    return (
      <section className="panel fine-tune" aria-label="Fine-tune the picture">
        {heading}
      </section>
    )
  if (view.picture.kind === 'none') {
    return (
      <section className="panel fine-tune" aria-label="Fine-tune the picture">
        {heading}
        <p className="muted">
          There&apos;s no picture to fine-tune yet. Make takes and choose one, then change it here.
        </p>
      </section>
    )
  }

  const { picture } = view
  const pictureKey = picture.kind === 'take' ? `take-${picture.n}` : 'game'
  const mark = marked?.picture === pictureKey ? marked.area : null
  const model = pick ?? startEditModel(view.models)
  const id = encodeURIComponent(row.id)
  const baseSrc =
    picture.kind === 'take'
      ? `/api/images/${id}/takes/${picture.n}`
      : `/api/images/${id}/fine-tunes/base`
  const tuneSrc = (n: number) => `/api/images/${id}/fine-tunes/${n}`
  const busy = view.making.length > 0
  const modelHere = view.models[model] === 'whole'
  const words1 = words.trim()
  const makeWhy = !view.maker.ok
    ? view.maker.message
    : !modelHere
      ? modelMissingWhy(editModel(model).name)
      : words1 === ''
        ? 'Say what to change first.'
        : busy || make.isPending
          ? 'Fine-tunes are being made for this picture. Make more when they are done, or Stop.'
          : null
  const menuWhy = !view.maker.ok
    ? view.maker.message
    : busy || make.isPending
      ? 'Fine-tunes are being made for this picture. Change this when they are done, or Stop.'
      : null
  const problem = refusal(make.data) ?? refusal(drop.data) ?? refusal(use.data)
  const error = make.error ?? drop.error ?? use.error ?? stop.error
  const items = [
    ...tunes.map((t) => ({
      n: t.n,
      tune: t as FineTuneView | null,
      making: null as FineTuneMakingView | null,
      failed: null as FineTuneFailedView | null,
    })),
    ...view.making.map((m) => ({ n: m.n, tune: null, making: m, failed: null })),
    ...view.failed.map((f) => ({ n: f.n, tune: null, making: null, failed: f })),
  ].sort((a, b) => a.n - b.n)

  const onDrop = (n: number) => {
    if (changing.current) return
    const next = strip.includes(n) ? rightAfterDrop(strip, n) : lookingAt
    // After a card being made is stopped, the next one to be made is where focus goes.
    const nextMaking = view.making.find((m) => m.n > n && m.state === 'waiting')
    drop.reset()
    setLooking(next)
    changing.current = true
    drop.mutate(n, {
      onSettled: () => {
        changing.current = false
        setPendingFocus(
          view.making.some((m) => m.n === n) && nextMaking
            ? { stop: nextMaking.n }
            : (next ?? 'words'),
        )
      },
    })
  }
  const onUse = (n: number) => {
    if (changing.current) return
    use.reset()
    changing.current = true
    use.mutate(n, {
      onSuccess: (answer) => {
        if (!answer.ok) return
        setCame({ answer, from: pictureKey })
        setWords('')
        setLooking(null)
        setMarked(null)
        setPendingFocus('words')
      },
      onSettled: () => {
        changing.current = false
      },
    })
  }
  const dragTo = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const dragged = areaFromDrag(
      start.current,
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      picture,
    )
    // A click, or a drag too small to change, changes nothing.
    if (dragged) setMarked({ picture: pictureKey, area: dragged })
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (!KEYS.has(event.key) && !KEYS.has(event.key.toLowerCase())) return
    // Keys typed into a field or menu are its own.
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement && target.type !== 'checkbox')
    )
      return
    // The image's own keys rest while focus is inside the panel.
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
    if (key === 'd' && shown && !event.repeat) onDrop(shown.n)
  }

  const overlaid = showing ? shown : null
  const showMark = mark !== null
  return (
    <section className="panel fine-tune" aria-label="Fine-tune the picture" onKeyDown={onKeyDown}>
      {heading}
      <p className="muted">
        Change one thing in the picture in the game from words: add, remove or change something. The
        rest stays as it is. Use one and it replaces the picture; the old one stays among the takes.
      </p>
      {cameHere && (
        <section className="notice notice-ok" aria-label="Fine-tune used" role="status">
          <div className="notice-text">
            <strong>{cameAlongLine(cameHere.take, cameHere.carried, cameHere.from)}</strong>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setCame(null)}>
            Close
          </button>
        </section>
      )}
      <div className="patch-bench">
        <div className="patch-bench-left">
          <div
            className="patch-stage"
            style={{ aspectRatio: `${picture.width} / ${picture.height}` }}
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
              src={baseSrc}
              alt={pictureCaption(picture)}
              draggable={false}
            />
            {overlaid && (
              <img
                className="patch-over"
                src={tuneSrc(overlaid.n)}
                alt={`Fine-tune ${overlaid.n}`}
                draggable={false}
              />
            )}
            {showMark && mark && <div className="patch-mark" style={placed(mark, picture)} />}
          </div>
          <div className="patch-looking">
            {shown ? (
              <>
                <b>Looking at Fine-tune {shown.n}</b>
                <label className="patch-toggle">
                  <input
                    className="patch-switch"
                    type="checkbox"
                    checked={showing}
                    onChange={(event) => setShowing(event.target.checked)}
                  />
                  Show the fine-tune <span className="faint small">(S)</span>
                </label>
              </>
            ) : (
              <span className="faint small">{pictureCaption(picture)}</span>
            )}
          </div>
          {mark ? (
            <span className="muted small">
              Marked area: the change is kept to this place.{' '}
              <button type="button" className="patch-back" onClick={() => setMarked(null)}>
                Clear the mark
              </button>
            </span>
          ) : (
            <span className="muted small">
              No area marked: the whole picture may change. Drag on the picture to keep the change
              to one place.
            </span>
          )}
        </div>
        <div className="patch-bench-right">
          <label className="field">
            <span className="lbl">What to change</span>
            <textarea
              ref={wordsBox}
              className="input"
              rows={3}
              value={words}
              placeholder="Say what to add, remove or change"
              onChange={(event) => setWords(event.target.value)}
            />
          </label>
          <EditModelMenu
            value={model}
            onChange={setPick}
            downloads={view.models}
            failed={view.failedModels}
            label="Model for new takes"
            visible
            why={menuWhy}
          />
          <div className="patch-make">
            <select
              className="takes-count"
              aria-label="Number of fine-tunes"
              value={count}
              {...off(menuWhy)}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {Array.from({ length: MAX_AT_ONCE }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              {...off(makeWhy)}
              onClick={() => {
                make.reset()
                // The button goes off while they are made: focus goes to the fine-tune looked at, so ← and → keep stepping.
                setPendingFocus(lookingAt ?? 'words')
                make.mutate({ count, words: words1, area: mark, model })
              }}
            >
              {MAKE_LABEL}
            </button>
            {busy && (
              <button
                type="button"
                className="btn btn-ghost"
                {...off(stop.isPending && WAIT_FOR_CHANGE)}
                onClick={() => stop.mutate()}
              >
                Stop
              </button>
            )}
          </div>
          {!modelHere && <span className="faint small">{EDIT_SETUP_LINE}</span>}
          {!view.maker.ok && (
            <span className="takes-missing small" role="status">
              {view.maker.message}
            </span>
          )}
          {problem && <span className="adopt-error">{problem}</span>}
          {error && <span className="adopt-error">{error.message}</span>}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="takes-empty">No fine-tunes yet. Describe a change and make a few.</div>
      ) : (
        <div className="patch-thumbs">
          {items.map(({ n, tune, making, failed }) =>
            tune ? (
              <div
                key={n}
                className="patch-thumb fine-card"
                data-looking={n === lookingAt ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="fine-card-pick"
                  aria-pressed={n === lookingAt}
                  ref={(el) => {
                    if (el) cards.current.set(n, el)
                    else cards.current.delete(n)
                  }}
                  onClick={() => setLooking(n)}
                >
                  <Thumb
                    base={baseSrc}
                    over={tuneSrc(n)}
                    size={{ x: 0, y: 0, width: picture.width, height: picture.height }}
                  />
                  <span className="patch-thumb-label">
                    <span className="grow">Fine-tune {n}</span>
                    {tune.isNew && <span className="chip chip-new">new</span>}
                  </span>
                </button>
                <div className="patch-controls">
                  <button
                    type="button"
                    className="btn btn-primary"
                    {...off((use.isPending || drop.isPending) && WAIT_FOR_CHANGE)}
                    onClick={() => onUse(n)}
                  >
                    Use this
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    {...off((use.isPending || drop.isPending) && WAIT_FOR_CHANGE)}
                    onClick={() => onDrop(n)}
                  >
                    Drop
                  </button>
                </div>
              </div>
            ) : making ? (
              <div key={n} className="patch-thumb patch-thumb-making">
                <span className="patch-thumb-label">
                  <span className="grow">Fine-tune {n}</span>
                </span>
                <span className="faint small">
                  {making.state === 'making' ? 'Being made…' : 'Waiting'}
                </span>
                {making.state === 'making' && (
                  <>
                    <span className="faint small">{leftText(making)}</span>
                    <div className="bar" role="progressbar" aria-label={`Fine-tune ${n}`}>
                      <i style={{ width: `${Math.round(progressOf(making) * 100)}%` }} />
                    </div>
                    <div className="patch-controls">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        ref={(el) => {
                          if (el) stops.current.set(n, el)
                          else stops.current.delete(n)
                        }}
                        {...off((use.isPending || drop.isPending) && WAIT_FOR_CHANGE)}
                        onClick={() => onDrop(n)}
                      >
                        Stop
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              failed && (
                <div key={n} className="patch-thumb errbox" role="alert">
                  <span className="patch-thumb-label">
                    <strong>Fine-tune {n}</strong>
                  </span>
                  <span className="muted small">{failed.message}</span>
                  <div className="patch-controls">
                    <button
                      type="button"
                      className="btn"
                      {...off(
                        !view.maker.ok && view.maker.message,
                        view.models[failed.model] !== 'whole' &&
                          modelMissingWhy(editModel(failed.model).name),
                        make.isPending && WAIT_FOR_CHANGE,
                      )}
                      onClick={() => make.mutate({ retry: n })}
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      {...off((use.isPending || drop.isPending) && WAIT_FOR_CHANGE)}
                      onClick={() => onDrop(n)}
                    >
                      Drop
                    </button>
                  </div>
                </div>
              )
            ),
          )}
        </div>
      )}
    </section>
  )
}
