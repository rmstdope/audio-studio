import { fieldOwnsKeys, NOT_YET, useDocumentKeys, usePendingFocus } from './useWorkbenchKeys'
import { useJobOpen } from './ImageJobTabs'
import { FitPicture, pictureShape } from './FitPicture'
import { useFillWindow } from '../../fillWindow'
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
  fineTuneHistory,
  shortened,
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
  useChooseImageTake,
  useDropFineTune,
  useImageTakes,
  useFineTunes,
  useMakeFineTunes,
  useMarkFineTuneSeen,
  useStopFineTunes,
  useUseFineTune,
} from '../../api'
import { areaFromDrag } from '../../imagePatchArea'
import {
  IMAGES_LOCK_WHY,
  JUST_FINISHED,
  modelMissingWhy,
  refusal,
  STYLE_BROKEN_WHY,
  WAIT_FOR_CHANGE,
} from '../../imagesText'
import { progressOf } from '../../musicTakesText'
import { off } from '../../off'
import { EditModelMenu } from './EditModelMenu'
import { scrollWithin } from '../../scrollWithin'

/** How many fine-tunes one press can make. */
const MAX_AT_ONCE = 10

/** How long a card that has just turned ready keeps Choose and Drop off, in milliseconds. */
const SETTLE_MS = 1000

/** The keys the open Fine-tune tab hears anywhere on the page. */
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'c', 'd', 's', 'z'])

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
  if (making.state === 'waiting') return 'waiting'
  const left = making.expected - making.elapsed
  return left <= 0 ? 'taking longer than expected' : `about ${timeText(left, 'up')} left`
}

/** The text of the Make button: the count is the one in the menu beside it. */
function makeLabel(count: number): string {
  return `Make ${count} fine-tune${count === 1 ? '' : 's'}`
}

/** The caption under the big picture: which picture is in the game, and which fine-tune is over it. */
function stageCaption(picture: FineTunesView['picture'], over: number | null): string {
  const base = picture.kind === 'take' ? `Take ${picture.n}` : "the game's own image"
  return `In the game · ${base}${over === null ? '' : `, with Fine-tune ${over} over it`}`
}

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
 * The Fine-tune tab of an image: the picture in the game (the chosen take, or the game's own
 * image) as one large picture to mark and to lay fine-tunes over, with Before / after, Drop and
 * Choose under it; the History of the picture with its Undo, the words and the Make controls on
 * the right; and the fine-tunes as thumbs in a strip. Choosing one makes it the image's next
 * take, chosen. C, D, S, Z and the arrows act anywhere on the page while the tab is open.
 */
export function FineTunePanel({ row }: { row: ImageRow }) {
  const query = useFineTunes(row.id)
  const make = useMakeFineTunes(row.id)
  const stop = useStopFineTunes(row.id)
  const drop = useDropFineTune(row.id)
  const use = useUseFineTune(row.id)
  const choose = useChooseImageTake(row.id)
  const takesQuery = useImageTakes(row.id)
  const seen = useMarkFineTuneSeen(row.id)
  const jobOpen = useJobOpen()
  const [words, setWords] = useState('')
  // The mark belongs to the picture it was dragged on; another picture has none.
  const [marked, setMarked] = useState<{ picture: string; area: PatchArea } | null>(null)
  // The model picked in the menu: not remembered past the page, so it starts on `startEditModel`.
  const [pick, setPick] = useState<EditModelId | null>(null)
  const [count, setCount] = useState(4)
  const [looking, setLooking] = useState<number | null>(null)
  const [showing, setShowing] = useState(true)
  // What a use brought along, with the picture it was made from: the line is about the picture in
  // the game then or the new take, and goes quiet when another take is chosen.
  const [came, setCame] = useState<{
    answer: Extract<UseFineTuneAnswer, { ok: true }>
    from: string
  } | null>(null)
  const focusOn = usePendingFocus<number | 'words' | { stop: number }>((want) => {
    const target =
      want === 'words'
        ? wordsBox.current
        : typeof want === 'number'
          ? cards.current.get(want)
          : stops.current.get(want.stop)
    // A Stop that is not there yet waits for the page to show the next fine-tune being made.
    return !target && typeof want === 'object' ? NOT_YET : target
  }, query.data)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fill = useFillWindow()
  const asked = useRef(new Set<number>())
  const changing = useRef(false)
  const cameShown = useRef(false)
  const wordsBox = useRef<HTMLTextAreaElement>(null)
  const cards = useRef(new Map<number, HTMLButtonElement>())
  const stops = useRef(new Map<number, HTMLButtonElement>())
  // The keys are heard anywhere on the page, but only while this tab is the open one.
  const keys = useDocumentKeys(jobOpen)

  const view = query.data && 'picture' in query.data ? query.data : null
  const tunes = view?.tunes ?? []
  // A card that turns ready while the page is open keeps its buttons off for a second, so a click
  // meant for its Stop does not land on Choose. Cards there when the picture is first seen do not.
  const seenReady = useRef<{ picture: string; ns: Set<number> } | null>(null)
  const readyAt = useRef(new Map<number, number>())
  const [, tick] = useState(0)
  if (view) {
    const pic = view.picture.kind === 'take' ? `take-${view.picture.n}` : view.picture.kind
    if (seenReady.current?.picture !== pic) {
      seenReady.current = { picture: pic, ns: new Set(tunes.map((t) => t.n)) }
      readyAt.current.clear()
    }
    for (const t of tunes)
      if (!seenReady.current.ns.has(t.n)) {
        seenReady.current.ns.add(t.n)
        readyAt.current.set(t.n, Date.now())
      }
  }
  const justFinished = (n: number) => Date.now() < (readyAt.current.get(n) ?? 0) + SETTLE_MS
  useEffect(() => {
    // The soonest card still settling is the next to turn on; this effect runs again after it.
    const ends = [...readyAt.current.values()]
      .map((at) => at + SETTLE_MS - Date.now())
      .filter((left) => left > 0)
    if (ends.length === 0) return
    const next = Math.min(...ends)
    const timer = setTimeout(() => tick((n) => n + 1), next)
    return () => clearTimeout(timer)
  })
  const strip = tunes.map((t) => t.n)
  const fallback = tunes.at(-1)?.n ?? null
  const lookingAt = looking !== null && strip.includes(looking) ? looking : fallback
  const shown = tunes.find((t) => t.n === lookingAt) ?? null

  useEffect(() => {
    if (lookingAt !== looking) setLooking(lookingAt)
  })
  // A fine-tune laid over the picture once is no longer "new".
  useEffect(() => {
    if (jobOpen && shown?.isNew && !asked.current.has(shown.n)) {
      asked.current.add(shown.n)
      seen.mutate(shown.n)
    }
  })
  useEffect(() => {
    const card = lookingAt === null ? undefined : cards.current.get(lookingAt)
    scrollWithin(card, card?.closest<HTMLElement>('.patch-thumbs'))
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

  // Another take chosen in Takes ends the line about the last use (not the new take it made).
  const shownKey = !view
    ? null
    : view.picture.kind === 'take'
      ? `take-${view.picture.n}`
      : view.picture.kind === 'game'
        ? 'game'
        : 'none'
  // The source take may keep the line only until the new take has been shown: after that, only the
  // new take does, so Undo, a History step or a choose in Make ends it.
  if (!came) cameShown.current = false
  else if (shownKey === `take-${came.answer.take}`) cameShown.current = true
  const cameHere =
    came &&
    (shownKey === `take-${came.answer.take}` ||
      (!cameShown.current && (shownKey === null || shownKey === came.from)))
      ? came.answer
      : null
  if (came && !cameHere) setCame(null)
  keys.current = () => {}
  if (!view)
    return (
      <section className="panel fine-tune" aria-label="Fine-tune the picture">
        <h2 className="sr-only">Fine-tune the picture</h2>
      </section>
    )
  if (view.picture.kind === 'none') {
    return (
      <section className="panel fine-tune" aria-label="Fine-tune the picture">
        <h2 className="sr-only">Fine-tune the picture</h2>
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
  const takes = takesQuery.data && 'takes' in takesQuery.data ? takesQuery.data : null
  // The two queries refresh separately: until the takes know the chosen take, History says nothing.
  const chosenN = picture.kind === 'take' ? picture.n : null
  const history =
    takes && (chosenN === null || takes.takes.some((t) => t.n === chosenN))
      ? fineTuneHistory(takes.takes, chosenN)
      : null
  const changingPicture = use.isPending || drop.isPending || choose.isPending
  // Choosing (a fine-tune, or an earlier or later step) is refused while the lock cannot be read or the style is broken.
  const chooseWhy = takes?.lockUnread
    ? IMAGES_LOCK_WHY
    : takes?.lookError
      ? STYLE_BROKEN_WHY
      : changingPicture
        ? WAIT_FOR_CHANGE
        : null
  const problem =
    refusal(make.data) ?? refusal(drop.data) ?? refusal(use.data) ?? refusal(choose.data)
  const error = make.error ?? drop.error ?? use.error ?? stop.error ?? choose.error
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
    if (changing.current || justFinished(n)) return
    const next = strip.includes(n) ? rightAfterDrop(strip, n) : lookingAt
    // After a card being made is stopped, the next one to be made is where focus goes.
    const nextMaking = view.making.find((m) => m.n > n && m.state === 'waiting')
    drop.reset()
    setLooking(next)
    changing.current = true
    drop.mutate(n, {
      onSettled: () => {
        changing.current = false
        focusOn(
          view.making.some((m) => m.n === n) && nextMaking
            ? { stop: nextMaking.n }
            : (next ?? 'words'),
        )
      },
    })
  }
  const onUse = (n: number) => {
    if (changing.current || justFinished(n)) return
    use.reset()
    changing.current = true
    use.mutate(n, {
      onSuccess: (answer) => {
        if (!answer.ok) return
        setCame({ answer, from: pictureKey })
        setWords('')
        setLooking(null)
        setMarked(null)
        // Focus is not sent to the words box: Z right after a choose is Undo, not a letter.
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
  /** Chooses an earlier or later step of the history again: an ordinary choose of that take. */
  const onStep = (n: number) => {
    if (changing.current || chooseWhy !== null) return
    choose.reset()
    use.reset()
    changing.current = true
    choose.mutate(n, {
      onSuccess: (answer) => {
        if (!answer.ok) return
        setLooking(null)
        setMarked(null)
      },
      onSettled: () => {
        changing.current = false
      },
    })
  }
  keys.current = (event) => {
    const target = event.target
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (!KEYS.has(event.key) && !KEYS.has(key)) return
    // Keys typed into a field or menu are its own.
    if (fieldOwnsKeys(target)) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const next = stepRight(strip, lookingAt, event.key === 'ArrowLeft' ? -1 : 1)
      if (next !== null) setLooking(next)
      return
    }
    if (key === 's') {
      event.preventDefault()
      if (shown) setShowing((on) => !on)
      return
    }
    // Held down, C, D and Z would choose and drop back and forth.
    if (event.repeat) return
    if (key === 'c' && shown && chooseWhy === null) {
      event.preventDefault()
      onUse(shown.n)
    }
    if (key === 'd' && shown) {
      event.preventDefault()
      onDrop(shown.n)
    }
    if (key === 'z' && history?.undoTo != null) {
      event.preventDefault()
      onStep(history.undoTo)
    }
  }

  const overlaid = showing ? shown : null
  const showMark = mark !== null
  const stepLabel = (step: Extract<(typeof steps)[number], { kind: 'take' }>) =>
    [
      `Take ${step.n}`,
      step.inGame && 'in the game',
      step.from === 'game' && "from the game's own image",
      step.words === null ? 'made from the prompt' : `“${shortened(step.words)}”`,
    ]
      .filter(Boolean)
      .join(' · ')
  const steps = history?.steps ?? []
  return (
    <section className="panel fine-tune" aria-label="Fine-tune the picture">
      <h2 className="sr-only">Fine-tune the picture</h2>
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
      <div className="fine-job" ref={fill}>
        <div className="fine-stage">
          <FitPicture>
            <div
              className="patch-stage fit-shape"
              style={pictureShape(picture.width, picture.height)}
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
          </FitPicture>
          <div className="fine-under">
            <span className="fine-caption">
              {stageCaption(picture, overlaid?.n ?? null)}
              {overlaid?.isNew && <span className="chip chip-new">new</span>}
            </span>
            <span className="fine-buttons">
              <button
                type="button"
                className="btn"
                aria-pressed={showing}
                {...off(!shown && 'Make a fine-tune first.')}
                onClick={() => setShowing((on) => !on)}
              >
                Before / after <span className="faint small">S</span>
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                {...off(
                  !shown && 'Make a fine-tune first.',
                  shown && changingPicture && WAIT_FOR_CHANGE,
                  shown && justFinished(shown.n) && JUST_FINISHED,
                )}
                onClick={() => shown && onDrop(shown.n)}
              >
                Drop <span className="faint small">D</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                {...off(
                  !shown && 'Make a fine-tune first.',
                  chooseWhy,
                  shown && justFinished(shown.n) && JUST_FINISHED,
                )}
                onClick={() => shown && onUse(shown.n)}
              >
                Choose <span className="faint small">C</span>
              </button>
            </span>
          </div>
        </div>
        <div className="fine-tools">
          {history && (
            <>
              <h3>History</h3>
              <div className="history">
                {steps.map((step) =>
                  step.kind === 'game' ? (
                    <div key="game" className="history-step" data-now="true">
                      <span className="history-dot" />
                      <span>The game&apos;s own image</span>
                    </div>
                  ) : (
                    <div
                      key={step.n}
                      className="history-step"
                      data-now={step.inGame ? 'true' : undefined}
                      data-after={step.after ? 'true' : undefined}
                    >
                      <span className="history-dot" />
                      {step.inGame ? (
                        <span>{stepLabel(step)}</span>
                      ) : (
                        <button
                          type="button"
                          className="history-pick"
                          title={`Choose Take ${step.n} again`}
                          {...off(chooseWhy)}
                          onClick={() => onStep(step.n)}
                        >
                          {stepLabel(step)}
                        </button>
                      )}
                    </div>
                  ),
                )}
              </div>
              {history.undoTo !== null && (
                <button
                  type="button"
                  className="btn"
                  {...off(chooseWhy)}
                  onClick={() => history.undoTo !== null && onStep(history.undoTo)}
                >
                  Undo: back to Take {history.undoTo} <span className="faint small">Z</span>
                </button>
              )}
            </>
          )}
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
          <span className="muted small">
            Drag on the picture to change only part of it; with no mark the whole picture is
            changed.{' '}
            {mark && (
              <button type="button" className="patch-back" onClick={() => setMarked(null)}>
                Clear the mark
              </button>
            )}
          </span>
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
                focusOn(lookingAt ?? 'words')
                make.mutate({ count, words: words1, area: mark, model })
              }}
            >
              {makeLabel(count)}
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
        <div className="fine-strip">
          <span className="fine-strip-label">Fine-tunes</span>
          {items.length === 0 ? (
            <div className="takes-empty">No fine-tunes yet. Describe a change and make a few.</div>
          ) : (
            <div className="patch-thumbs fine-thumbs">
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
                  </div>
                ) : making ? (
                  <div key={n} className="patch-thumb patch-thumb-making">
                    <div
                      className="patch-making-pic"
                      style={{ aspectRatio: `${picture.width} / ${picture.height}` }}
                    >
                      {making.state === 'making' ? 'Being made…' : 'Waiting'}
                    </div>
                    <span className="patch-thumb-label">
                      <span>
                        <b>Fine-tune {n}</b> · {making.state === 'making' ? 'making, ' : ''}
                        {leftText(making)}
                      </span>
                    </span>
                    {making.state === 'making' && (
                      <>
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
        </div>
      </div>
    </section>
  )
}
