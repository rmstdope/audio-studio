import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  rightAfterDrop,
  stepRight,
  type ImageMakingView,
  type ImageTakeView,
  type ImageTakesView,
} from '../../../core/imageTakes'
import {
  setAsideQuestion,
  type SetAsideAsk,
  type SetAsideQuestion,
} from '../../../core/imagePatches'
import type { ImageRow } from '../../../core/images'
import {
  IMAGE_MODEL_IDS,
  defaultTakeModel,
  imageMenuEntry,
  imageModel,
  imageShortEntry,
  imageSwitchedLine,
  type ImageModelId,
} from '../../../core/imageModels'
import {
  useChooseImageTake,
  useDropImageTake,
  useFigures,
  useImageTakes,
  useMakeImageTakes,
  useMarkImageTakeSeen,
  useStopImageTakes,
  useUnchooseImageTake,
} from '../../api'
import { Confirm } from '../../components/Confirm'
import { off } from '../../off'
import { MenuFace } from '../../components/MenuFace'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import {
  BRINGING_WHY,
  IMAGES_LOCK_WHY,
  imageMakeWhy,
  imageMenuWhy,
  lookZoom,
  makeTakesText,
  QUESTION_OPEN_WHY,
  refusal,
  pictureRendering,
  setAsideDim,
  setAsideLead,
  setAsideTitle,
  STYLE_BROKEN_WHY,
  takeCountText,
  unchooseNote,
  WAIT_FOR_CHANGE,
} from '../../imagesText'
import { failureLine, progressOf } from '../../musicTakesText'
import { imageTimeLeftText } from '../../imageTakesText'
import { routeHref } from '../../route'
import { TakePicture, gameSource, modelSource, type Showing } from './TakePicture'

/** The inputs that are pressed rather than typed into, which leave the page's keys to it. */
const PRESSED_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset'])

/** How many takes one press can make. */
const MAX_AT_ONCE = 4

/** The space between the two sides, in pixels (the stylesheet's `.image-stage` gap). */
const STAGE_GAP = 14

/**
 * A take's picture; `shown` is its width on the page, when set, and a picture shown smaller than
 * its own `width` is drawn smooth, else with hard pixels.
 */
function Picture({
  src,
  alt,
  width,
  height,
  shown,
}: {
  src: string
  alt: string
  width: number
  height: number
  shown?: number
}) {
  return (
    <img
      className="image-take-picture"
      src={src}
      alt={alt}
      style={{
        width: shown,
        aspectRatio: `${width} / ${height}`,
        imageRendering: shown === undefined ? undefined : pictureRendering(shown / width),
      }}
    />
  )
}

/** A frame with nothing in it yet. */
function EmptyFrame({
  title,
  hint,
  width,
  height,
}: {
  title: string
  hint?: string
  width: number
  height: number
}) {
  return (
    <div className="image-take-empty" style={{ aspectRatio: `${width} / ${height}` }}>
      <b>{title}</b>
      {hint && <span className="faint small">{hint}</span>}
    </div>
  )
}

/**
 * The body of a question about what is set aside: the sentence, then the titles that leave, one
 * per line; with both patches and areas, two lists each under its small heading, patches first.
 */
function SetAsideLists({ ask, question }: { ask: SetAsideAsk; question: SetAsideQuestion }) {
  const both = question.leaving.length > 0 && question.leavingAreas.length > 0
  const list = (heading: string, titles: string[]) =>
    titles.length > 0 && (
      <>
        {both && <h4 className="confirm-heading">{heading}</h4>}
        <ul className="confirm-effects">
          {titles.map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ul>
      </>
    )
  return (
    <>
      <p>{setAsideLead(ask, question)}</p>
      {list('Patches', question.leaving)}
      {list('Named areas', question.leavingAreas)}
    </>
  )
}

/**
 * An image's workbench: in one column `prompt` (the image's words), making takes, and the other
 * takes to put on the right; in the other the image the game uses beside one other take (one
 * above the other when the column is too narrow for both at the game's size), with choosing,
 * un-choosing and dropping under them, also by C and D. A box switches every take shown between
 * what the model made and what the game gets. Which take is on the right, and what the box says,
 * are this page's, never saved; after a reload it is the newest, and what the game gets.
 */
export function TakesSection({
  row,
  prompt,
  saveWords,
}: {
  row: ImageRow
  prompt?: ReactNode
  /** Sees the prompt's words saved: whether they were, or null with nothing to save. */
  saveWords?: () => Promise<boolean> | null
}) {
  const id = row.id
  const query = useImageTakes(id)
  const figures = useFigures()
  const make = useMakeImageTakes(id)
  const stop = useStopImageTakes(id)
  const choose = useChooseImageTake(id)
  const drop = useDropImageTake(id)
  const unchoose = useUnchooseImageTake(id)
  const seen = useMarkImageTakeSeen(id)
  const client = useQueryClient()
  const view = query.data
  const [right, setRight] = useState<number | null>(null)
  const [wasChosen, setWasChosen] = useState<number | null>(null)
  const [count, setCount] = useState(2)
  const [picked, setPicked] = useState<ImageModelId | null>(null)
  // The question open: choosing, un-choosing or dropping a take with chosen patches asks first.
  const [asking, setAsking] = useState<SetAsideAsk | null>(null)
  const open = asking !== null
  // What the question said when it opened: it stays as it was while the save and the reload land.
  const [frozen, setFrozen] = useState<{ question: SetAsideQuestion | null; take: number }>({
    question: null,
    take: 0,
  })
  const [saved, setSaved] = useState(0)
  const [pendingFocus, setPendingFocus] = useState<'choose' | 'right' | number | null>(null)
  const [waitingForWords, setWaitingForWords] = useState(false)
  const [showing, setShowing] = useState<Showing>('game')
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const [available, setAvailable] = useState(0)
  const asked = useRef(new Set<number>())
  // Focus asked for by a press of Make does not scroll: a mouse press stays where it was.
  const focusQuietly = useRef(false)
  const chooseButton = useRef<HTMLButtonElement>(null)
  const unchooseButton = useRef<HTMLButtonElement>(null)
  const dropButton = useRef<HTMLButtonElement>(null)
  const leftHeading = useRef<HTMLSpanElement>(null)
  const rightHeading = useRef<HTMLSpanElement>(null)
  const thumbs = useRef(new Map<number, HTMLButtonElement>())
  // The page's keys (← → C D) are heard anywhere on the page, by the handler of the last render.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {})
  let onKey: (event: KeyboardEvent) => void = () => {}
  useEffect(() => {
    keys.current = onKey
  })
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event)
    document.addEventListener('keydown', listen)
    return () => document.removeEventListener('keydown', listen)
  }, [])
  // A choice or drop asked for by a key and not yet settled: a second press waits for it, since the
  // handler it would reach still sees the take as it was.
  const changing = useRef(false)
  const refocusUnchoose = useFocusWhenClosed(open, unchooseButton)
  const refocusChoose = useFocusWhenClosed(open, chooseButton)
  const refocusDrop = useFocusWhenClosed(open, dropButton)
  const focusLeft = useFocusWhenClosed(open, leftHeading)

  const ready = view && 'takes' in view ? view : null
  const others = ready ? ready.takes.filter((t) => !t.chosen) : []
  const strip = others.map((t) => t.n)
  const onRight = right !== null && strip.includes(right) ? right : (strip.at(-1) ?? null)

  // The right side starts on the newest take and stays where it is put; it moves only when its
  // take leaves the grid.
  useEffect(() => {
    if (strip.length && (right === null || !strip.includes(right))) setRight(strip.at(-1)!)
  })
  // A take shown on the right once is no longer "new".
  const shown = ready?.takes.find((t) => t.n === onRight)
  useEffect(() => {
    if (shown?.isNew && !asked.current.has(shown.n)) {
      asked.current.add(shown.n)
      seen.mutate(shown.n)
    }
  })
  // The grid scrolls on its own: the take on the right is kept in view as ← and → step.
  useEffect(() => {
    if (onRight !== null) thumbs.current.get(onRight)?.scrollIntoView?.({ block: 'nearest' })
  }, [onRight])
  useEffect(() => {
    if (!stage || typeof ResizeObserver === 'undefined') return
    const measure = () => setAvailable(stage.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [stage])
  useEffect(() => {
    if (pendingFocus === null) return
    const target =
      pendingFocus === 'choose'
        ? chooseButton.current
        : pendingFocus === 'right'
          ? rightHeading.current
          : thumbs.current.get(pendingFocus)
    // Asked for once the change has settled: tried once, and given up on if the target cannot take it.
    target?.focus(focusQuietly.current ? { preventScroll: true } : undefined)
    focusQuietly.current = false
    setPendingFocus(null)
  }, [pendingFocus])

  if (!view || !ready) {
    // The same shape as the workbench below, so the prompt is not made again (losing words being
    // written) when the takes come and go.
    return (
      <>
        {null}
        {[]}
        <div className="image-workbench">
          <div className="image-workbench-tools">{prompt}</div>
          <section className="panel">
            {!view
              ? query.isError
                ? 'The takes could not be loaded.'
                : 'Loading takes…'
              : 'The takes could not be listed.'}
          </section>
        </div>
      </>
    )
  }

  const { generator, takes, making, failed, lockUnread, lookError } = ready
  const states = Object.fromEntries(ready.models.map((m) => [m.id, m])) as Record<
    ImageModelId,
    ImageTakesView['models'][number]
  >
  const installed = Object.fromEntries(ready.models.map((m) => [m.id, m.installed])) as Record<
    ImageModelId,
    boolean
  >
  const fallback = defaultTakeModel(ready.projectModel, states)
  // A pick that has since gone missing falls back; the pick is this page's and is never saved.
  const model = picked && installed[picked] ? picked : fallback
  const otherInUse = fallback !== ready.projectModel
  const chosen = takes.find((t) => t.chosen)
  const rightTake = takes.find((t) => t.n === onRight)
  const none = takes.length === 0 && making.length === 0
  const busy = making.length > 0
  const why = {
    generatorOk: generator.ok,
    making: busy || make.isPending,
    savingWords: waitingForWords,
  }
  const menuWhy = imageMenuWhy(why)
  const makeWhy = imageMakeWhy(why)
  const size = { width: row.width, height: row.height }
  // The two sides sit side by side at the largest whole size at which both fit, else shrunk side by
  // side down to half the game's size, else one above the other (lookZoom).
  const { zoom, stacked } = lookZoom(available, STAGE_GAP, row.width)
  const set = (update: (v: ImageTakesView) => ImageTakesView) =>
    client.setQueryData<ImageTakesView>(['image-takes', id], (v) =>
      v && 'takes' in v ? update(v) : v,
    )

  /** Stops a poll on its way (it would bring back what is about to change), and clears older refusals. */
  const beforeChange = () => {
    void client.cancelQueries({ queryKey: ['image-takes', id] })
    for (const mutation of [make, choose, drop, unchoose]) mutation.reset()
  }
  const canChoose = (t: ImageTakeView) =>
    !lockUnread &&
    !choose.isPending &&
    !drop.isPending &&
    lookError === null &&
    t.look !== 'bringing'
  const canDrop = !lockUnread && !drop.isPending && !choose.isPending
  const dropWhy = lockUnread ? IMAGES_LOCK_WHY : WAIT_FOR_CHANGE
  const chooseWhy = (t: ImageTakeView) =>
    !canDrop
      ? dropWhy
      : lookError !== null
        ? STYLE_BROKEN_WHY
        : t.look === 'bringing'
          ? BRINGING_WHY
          : WAIT_FOR_CHANGE
  /** Chooses take `n`; `confirmed` is after the question, which waits for the save before it closes. */
  const onChoose = (n: number, confirmed = false) => {
    const before = chosen?.n ?? null
    beforeChange()
    // The page shows the choice at once; a refusal puts it back when the takes are read again.
    const show = () => {
      set((v) => ({
        ...v,
        takes: v.takes.map((t) => ({
          ...t,
          chosen: t.n === n,
          isNew: t.n === n ? false : t.isNew,
        })),
      }))
      setWasChosen(before)
      setRight(before ?? rightAfterDrop(strip, n))
    }
    if (!confirmed) show()
    // Focus is asked for once the save has settled: asked earlier, it would be given to the button
    // just before the button is switched off, and the browser drops it from a disabled button.
    const focus = before !== null || strip.length > 1 ? 'choose' : 'right'
    changing.current = true
    choose.mutate(n, {
      onSuccess: (answer) => {
        setSaved((count) => count + 1)
        if (confirmed && answer.ok) {
          show()
          setAsking(null)
        }
      },
      onSettled: (answer) => {
        changing.current = false
        if (!confirmed || answer?.ok) setPendingFocus(focus)
      },
    })
  }
  const onDrop = (n: number, confirmed = false) => {
    const next = rightAfterDrop(strip, n)
    beforeChange()
    const show = () => {
      set((v) => ({ ...v, takes: v.takes.filter((t) => t.n !== n) }))
      setRight(next)
    }
    if (!confirmed) show()
    changing.current = true
    drop.mutate(n, {
      onSuccess: (answer) => {
        if (confirmed && answer.ok) {
          show()
          setAsking(null)
        }
      },
      onSettled: (answer) => {
        changing.current = false
        if (!confirmed || answer?.ok) setPendingFocus(next ?? 'right')
      },
    })
  }
  /** Asks first when chosen patches would be set aside or lost, else does it at once. */
  const request = (ask: SetAsideAsk) => {
    if (!setAsideQuestion(row, ask)) {
      if (ask.kind === 'choose') onChoose(ask.n)
      else if (ask.kind === 'drop') onDrop(ask.n)
      return
    }
    beforeChange()
    setFrozen({ question: setAsideQuestion(row, ask), take: chosen?.n ?? 0 })
    setAsking(ask)
  }
  /** Closes the question without acting, and returns focus to the button that opened it. */
  const cancelAsking = () => {
    if (asking?.kind === 'choose') refocusChoose()
    else if (asking?.kind === 'drop') refocusDrop()
    else refocusUnchoose()
    for (const mutation of [choose, drop, unchoose]) mutation.reset()
    setAsking(null)
  }
  onKey = (event: KeyboardEvent) => {
    const target = event.target
    if (event.defaultPrevented || open) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (target instanceof HTMLElement && target.isContentEditable) return
    // Keys typed into a field or menu are its own; a box or button leaves them to the page, but
    // a radio keeps its arrows.
    const box = target instanceof HTMLInputElement && PRESSED_INPUTS.has(target.type)
    if (
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && !box)
    )
      return
    const arrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
    if (arrow && target instanceof HTMLInputElement && target.type === 'radio') return
    if (arrow) {
      const next = stepRight(strip, onRight, event.key === 'ArrowLeft' ? -1 : 1)
      event.preventDefault()
      if (next !== null) setRight(next)
    }
    // Held down, C and D would choose back and forth, or drop take after take.
    if (!rightTake || event.repeat || changing.current) return
    const key = event.key.toLowerCase()
    if (key === 'c' && canChoose(rightTake)) {
      event.preventDefault()
      request({ kind: 'choose', n: rightTake.n })
    }
    if (key === 'd' && canDrop) {
      event.preventDefault()
      request({ kind: 'drop', n: rightTake.n })
    }
  }

  /** Takes are made from the saved words, so `ask` waits until they are the words in the field. */
  const afterWordsSaved = (ask: () => void) => {
    const saving = saveWords?.() ?? null
    if (saving === null) return ask()
    setWaitingForWords(true)
    void saving.then((wordsSaved) => {
      setWaitingForWords(false)
      if (wordsSaved) ask()
    })
  }

  const controls = (
    <>
      <MenuFace text={imageShortEntry(model, figures)}>
        <select
          className="takes-model"
          aria-label="Model for new takes"
          value={model}
          {...off(menuWhy)}
          onChange={(event) => setPicked(event.target.value as ImageModelId)}
        >
          {IMAGE_MODEL_IDS.map((id) => (
            <option key={id} value={id} disabled={!installed[id]}>
              {imageMenuEntry(id, states[id], figures)}
            </option>
          ))}
        </select>
      </MenuFace>
      <select
        className="takes-count"
        aria-label="Number of new takes"
        value={count}
        {...off(menuWhy)}
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
        {...off(makeWhy)}
        onClick={() => {
          // The button is off while takes are made, and the browser drops focus from it; focus
          // goes to the take on the right in the grid, so ← and → keep stepping it.
          focusQuietly.current = true
          setPendingFocus(onRight ?? 'right')
          afterWordsSaved(() => make.mutate({ count, model }))
        }}
      >
        {makeTakesText(count, !none)}
      </button>
    </>
  )
  const problem =
    refusal(make.data) ?? refusal(choose.data) ?? refusal(drop.data) ?? refusal(unchoose.data)
  const error = make.error ?? choose.error ?? drop.error ?? unchoose.error ?? stop.error
  // The red line under an open question's buttons: the studio's own message for the last try.
  const question = frozen.question
  const answering = asking?.kind === 'choose' ? choose : asking?.kind === 'drop' ? drop : unchoose
  const askError = refusal(answering.data) ?? answering.error?.message ?? null

  return (
    <>
      {!generator.ok && (
        <div className="errbox" role="alert">
          <div className="errbox-text">
            <strong>Images can&apos;t be made yet.</strong>
            <span className="muted small">
              No image model can run on this computer. Setup says what is missing.
            </span>
          </div>
          <a className="btn" href={routeHref({ view: 'setup' })}>
            Open Setup
          </a>
        </div>
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
            {...off(
              !generator.ok && imageMakeWhy({ ...why, making: false, savingWords: false }),
              make.isPending && WAIT_FOR_CHANGE,
              waitingForWords && imageMakeWhy({ ...why, making: false }),
            )}
            onClick={() => afterWordsSaved(() => make.mutate({ retry: f.n }))}
          >
            Try again
          </button>
        </div>
      ))}
      <div className="image-workbench">
        <div className="image-workbench-tools">
          {prompt}
          <section className="panel takes-panel image-make" aria-label="Make takes">
            <div className="takes-head">
              <h2>Make takes</h2>
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
            {otherInUse && generator.ok && (
              <span className="takes-missing small" role="status">
                {states[ready.projectModel].installed
                  ? imageSwitchedLine(ready.projectModel, fallback)
                  : states[ready.projectModel].download === 'partial'
                    ? `${imageModel(ready.projectModel).short}, the project's image model, is only partly downloaded, so these takes use ${imageModel(fallback).short}. Setup says how to finish it.`
                    : `${imageModel(ready.projectModel).short}, the project's image model, isn't on this computer, so these takes use ${imageModel(fallback).short}. Setup says how to download it.`}
              </span>
            )}
            <div className="takes-make">{controls}</div>
          </section>
          <section className="panel takes-panel image-takes" aria-label="Takes">
            <div className="takes-head">
              <h2>{none ? 'Takes' : `Takes · ${strip.length}`}</h2>
              {!none && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showing === 'game'}
                    onChange={(event) => setShowing(event.target.checked ? 'game' : 'model')}
                  />
                  What the game gets
                </label>
              )}
            </div>
            {lockUnread && !none && (
              <span className="takes-missing small">
                Choosing, dropping and un-choosing wait until the images lock can be read. You can
                still look and make more takes.
              </span>
            )}
            {strip.length > 0 || making.length > 0 ? (
              <div className="image-thumbs" data-strip>
                {others.map((t) => {
                  const src =
                    showing === 'game' ? gameSource(id, t, row, lookError) : modelSource(id, t)
                  return (
                    <button
                      type="button"
                      key={t.n}
                      className="image-thumb"
                      aria-pressed={t.n === onRight}
                      ref={(el) => {
                        if (el) thumbs.current.set(t.n, el)
                        else thumbs.current.delete(t.n)
                      }}
                      onClick={() => setRight(t.n)}
                    >
                      {src ? (
                        <Picture
                          src={src}
                          alt=""
                          {...(showing === 'game' ? size : { width: t.width, height: t.height })}
                        />
                      ) : (
                        <div
                          className="image-take-empty"
                          style={{ aspectRatio: `${row.width} / ${row.height}` }}
                        />
                      )}
                      <span className="image-thumb-label">
                        <span className="grow">Take {t.n}</span>
                        {t.earlier && <span className="faint">earlier words</span>}
                        {t.n === wasChosen && <span className="faint">was chosen</span>}
                        {t.isNew && <span className="chip chip-new">new</span>}
                      </span>
                    </button>
                  )
                })}
                {making.map((m) => (
                  <MakingThumb key={m.n} making={m} {...size} />
                ))}
              </div>
            ) : null}
            {strip.length > 0 && (
              <span className="faint small">
                Press a take, or use <kbd>←</kbd> <kbd>→</kbd>, to put it beside the image the game
                uses.
              </span>
            )}
            {none && (
              <div className="takes-empty">
                <strong>Each take is a new image made from the prompt.</strong>
                <span className="muted">
                  Make a few, compare them, and choose the one the game shows.
                </span>
              </div>
            )}
          </section>
        </div>
        <section
          className="panel image-stage-panel"
          aria-label="The chosen take and one to compare"
        >
          <div className="image-stage" data-stacked={stacked} ref={setStage}>
            <div className="image-side" data-side="left">
              {asking && asking.kind !== 'drop' ? (
                <Confirm
                  title={setAsideTitle(asking, frozen.take)}
                  lead={
                    question && (
                      <>
                        {asking.kind === 'unchoose' && (
                          <span className="muted">{unchooseNote(question.from)}</span>
                        )}
                        <SetAsideLists ask={asking} question={question} />
                      </>
                    )
                  }
                  effects={[]}
                  note={
                    question
                      ? setAsideDim(question)
                      : asking.kind === 'unchoose'
                        ? unchooseNote(frozen.take)
                        : undefined
                  }
                  error={askError}
                  back="Cancel"
                  backDisabled={answering.isPending}
                  onBack={cancelAsking}
                >
                  <button
                    className="btn btn-primary"
                    type="button"
                    autoFocus
                    {...off(answering.isPending && WAIT_FOR_CHANGE)}
                    onClick={() => {
                      if (asking.kind === 'choose') {
                        onChoose(asking.n, true)
                        return
                      }
                      unchoose.reset()
                      unchoose.mutate(undefined, {
                        onSuccess: (answer) => {
                          if (!answer.ok) return
                          setAsking(null)
                          focusLeft()
                        },
                      })
                    }}
                  >
                    {asking.kind === 'choose'
                      ? choose.isPending
                        ? 'Choosing…'
                        : `Choose take ${asking.n}`
                      : unchoose.isPending
                        ? 'Un-choosing…'
                        : 'Un-choose'}
                  </button>
                </Confirm>
              ) : (
                <LeftSide
                  row={row}
                  chosen={chosen}
                  lockUnread={lockUnread}
                  heading={leftHeading}
                  opener={unchooseButton}
                  unchoosing={unchoose.isPending || open}
                  saving={choose.isPending}
                  saved={saved}
                  onUnchoose={() => {
                    unchoose.reset()
                    setFrozen({
                      question: setAsideQuestion(row, { kind: 'unchoose' }),
                      take: chosen?.n ?? 0,
                    })
                    setAsking({ kind: 'unchoose' })
                  }}
                  size={size}
                  id={id}
                  lookError={lookError}
                  showing={showing}
                  zoom={zoom}
                />
              )}
            </div>
            <div className="image-side" data-side="right">
              <div className="take-row">
                <span className="lbl" ref={rightHeading} tabIndex={-1}>
                  Comparing
                </span>
                {rightTake ? (
                  <>
                    <b>Take {rightTake.n}</b>
                    <ModelName id={rightTake.model} />
                    {rightTake.earlier && <span className="faint small">earlier words</span>}
                  </>
                ) : (
                  <b>{chosen ? 'No other takes yet' : 'No takes yet'}</b>
                )}
              </div>
              {rightTake ? (
                <>
                  {asking?.kind === 'drop' && question ? (
                    <Confirm
                      title={setAsideTitle(asking, asking.n)}
                      lead={<SetAsideLists ask={asking} question={question} />}
                      effects={[]}
                      error={askError}
                      back="Cancel"
                      backDisabled={drop.isPending}
                      onBack={cancelAsking}
                    >
                      <button
                        className="btn btn-primary"
                        type="button"
                        autoFocus
                        {...off(drop.isPending && WAIT_FOR_CHANGE)}
                        onClick={() => onDrop(asking.n, true)}
                      >
                        {drop.isPending ? 'Dropping…' : `Drop take ${asking.n}`}
                      </button>
                    </Confirm>
                  ) : (
                    <TakePicture
                      id={id}
                      take={rightTake}
                      row={row}
                      lookError={lookError}
                      showing={showing}
                      zoom={zoom}
                    />
                  )}
                  <div className="image-take-actions">
                    <button
                      type="button"
                      ref={dropButton}
                      className="btn btn-ghost btn-small"
                      {...off(!canDrop && dropWhy, open && QUESTION_OPEN_WHY)}
                      onClick={() => request({ kind: 'drop', n: rightTake.n })}
                    >
                      Drop
                    </button>
                    <button
                      type="button"
                      ref={chooseButton}
                      className="btn btn-primary btn-small"
                      {...off(
                        !canChoose(rightTake) && chooseWhy(rightTake),
                        open && QUESTION_OPEN_WHY,
                      )}
                      onClick={() => request({ kind: 'choose', n: rightTake.n })}
                    >
                      Choose
                    </button>
                    <span className="faint small">
                      or press <kbd>D</kbd> to drop, <kbd>C</kbd> to choose
                    </span>
                  </div>
                  {lookError !== null && (
                    <span className="faint small">Fix the style to choose this take.</span>
                  )}
                </>
              ) : (
                <EmptyFrame
                  title={
                    chosen
                      ? 'No other takes yet — make a few more to compare with the chosen one.'
                      : 'No takes yet'
                  }
                  {...size}
                />
              )}
            </div>
          </div>
          {!open && problem && <span className="adopt-error">{problem}</span>}
          {!open && error && <span className="adopt-error">{error.message}</span>}
        </section>
      </div>
    </>
  )
}

/** The model that made a take, in faint text after its name; nothing for a model the studio does not know. */
function ModelName({ id }: { id: ImageModelId | null }) {
  return id ? <span className="faint small">{imageModel(id).short}</span> : null
}

/** The left side: the chosen take, the game's own image, or nothing. */
function LeftSide({
  row,
  chosen,
  lockUnread,
  heading,
  opener,
  unchoosing,
  saving,
  saved,
  onUnchoose,
  size,
  id,
  lookError,
  showing,
  zoom,
}: {
  row: ImageRow
  chosen: ImageTakeView | undefined
  lockUnread: boolean
  heading: React.RefObject<HTMLSpanElement | null>
  opener: React.RefObject<HTMLButtonElement | null>
  unchoosing: boolean
  saving: boolean
  saved: number
  onUnchoose: () => void
  size: { width: number; height: number }
  id: string
  lookError: string | null
  showing: Showing
  zoom: number
}) {
  const label = (
    <span className="lbl" ref={heading} tabIndex={-1}>
      In the game
    </span>
  )
  if (chosen) {
    return (
      <>
        <div className="take-row">
          {label}
          <b>Take {chosen.n}</b>
          <span className="chip chip-ok">Chosen</span>
          {row.looksOld && <span className="chip chip-warn">Old look</span>}
          <ModelName id={chosen.model} />
        </div>
        <TakePicture
          id={id}
          take={chosen}
          row={row}
          lookError={lookError}
          showing={showing}
          zoom={zoom}
          current
          saving={saving}
          saved={saved}
        />
        <div className="image-take-actions">
          <button
            type="button"
            ref={opener}
            className="btn btn-small"
            {...off(lockUnread && IMAGES_LOCK_WHY, unchoosing && WAIT_FOR_CHANGE)}
            onClick={onUnchoose}
          >
            Un-choose
          </button>
        </div>
      </>
    )
  }
  if (row.gameFile) {
    return (
      <>
        <div className="take-row">
          {label}
          <b>The game&apos;s own image</b>
        </div>
        {row.gameFile.exists ? (
          <Picture
            src={`/api/images/${encodeURIComponent(id)}/current`}
            alt="The game's own image"
            {...size}
            shown={size.width * zoom}
          />
        ) : (
          <EmptyFrame title="The file is not there." {...size} />
        )}
        <span className="mono muted small">{row.gameFile.file}</span>
        <span className="faint small">Choose a take and the game shows it instead.</span>
      </>
    )
  }
  return (
    <>
      <div className="take-row">{label}</div>
      <EmptyFrame
        title="Nothing shows here yet"
        hint="Choose a take and the game shows it."
        {...size}
      />
    </>
  )
}

/** A take waiting or being made, in the grid: its place, its time and a progress bar. */
function MakingThumb({
  making,
  width,
  height,
}: {
  making: ImageMakingView
  width: number
  height: number
}) {
  return (
    <div className="image-thumb image-thumb-making">
      <div className="image-take-empty" style={{ aspectRatio: `${width} / ${height}` }} />
      <span className="image-thumb-label">
        <span className="grow">Take {making.n}</span>
      </span>
      <span className="faint small">{imageTimeLeftText(making)}</span>
      <div className="bar" role="progressbar" aria-label={`Take ${making.n}`}>
        <i style={{ width: `${Math.round(progressOf(making) * 100)}%` }} />
      </div>
    </div>
  )
}
