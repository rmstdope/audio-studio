import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  rightAfterDrop,
  stepRight,
  type ImageMakingView,
  type ImageTakeView,
  type ImageTakesView,
} from '../../../core/imageTakes'
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
  useImageTakes,
  useMakeImageTakes,
  useMarkImageTakeSeen,
  useStopImageTakes,
  useUnchooseImageTake,
} from '../../api'
import { Confirm } from '../../components/Confirm'
import { openTracking } from '../../components/openTracking'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { makeTakesText, takeCountText, unchooseNote } from '../../imagesText'
import { failureLine, progressOf, timeLeftText } from '../../musicTakesText'
import { routeHref } from '../../route'
import { TakePair } from './TakePair'

/** How many takes one press can make. */
const MAX_AT_ONCE = 4

/** What a change to takes answered, as a line to show when it was refused. */
function refusal(answer: unknown): string | null {
  if (!answer || typeof answer !== 'object' || !('ok' in answer) || answer.ok) return null
  return 'message' in answer && typeof answer.message === 'string'
    ? answer.message
    : 'That could not be done.'
}

/** A take's picture, scaled up without smoothing. */
function Picture({
  src,
  alt,
  width,
  height,
}: {
  src: string
  alt: string
  width: number
  height: number
}) {
  return (
    <img
      className="image-take-picture"
      src={src}
      alt={alt}
      style={{ aspectRatio: `${width} / ${height}` }}
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
 * An image's Takes section: the image the game uses beside one other take, a strip of the rest to
 * put on the right, and making, choosing, un-choosing and dropping them. Which take is on the right
 * is this page's, never saved; after a reload it is the newest.
 */
export function TakesSection({ row }: { row: ImageRow }) {
  const id = row.id
  const query = useImageTakes(id)
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
  const [modelOpen, setModelOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [saved, setSaved] = useState(0)
  const [pendingFocus, setPendingFocus] = useState<'choose' | 'right' | number | null>(null)
  const asked = useRef(new Set<number>())
  const chooseButton = useRef<HTMLButtonElement>(null)
  const unchooseButton = useRef<HTMLButtonElement>(null)
  const leftHeading = useRef<HTMLSpanElement>(null)
  const rightHeading = useRef<HTMLSpanElement>(null)
  const thumbs = useRef(new Map<number, HTMLButtonElement>())
  const refocusUnchoose = useFocusWhenClosed(asking, unchooseButton)
  const focusLeft = useFocusWhenClosed(asking, leftHeading)

  const ready = view && 'takes' in view ? view : null
  const strip = ready ? ready.takes.filter((t) => !t.chosen).map((t) => t.n) : []
  const onRight = right !== null && strip.includes(right) ? right : (strip.at(-1) ?? null)

  // The right side starts on the newest take and stays where it is put; it moves only when its
  // take leaves the strip.
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
  useEffect(() => {
    if (pendingFocus === null) return
    const target =
      pendingFocus === 'choose'
        ? chooseButton.current
        : pendingFocus === 'right'
          ? rightHeading.current
          : thumbs.current.get(pendingFocus)
    // Asked for once the change has settled: tried once, and given up on if the target cannot take it.
    target?.focus()
    setPendingFocus(null)
  }, [pendingFocus])

  if (!view) {
    return (
      <section className="panel">
        {query.isError ? 'The takes could not be loaded.' : 'Loading takes…'}
      </section>
    )
  }
  if (!ready) return <section className="panel">The takes could not be listed.</section>

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
  const canMake = generator.ok && !busy && !make.isPending
  const size = { width: row.width, height: row.height }
  const set = (update: (v: ImageTakesView) => ImageTakesView) =>
    client.setQueryData<ImageTakesView>(['image-takes', id], (v) =>
      v && 'takes' in v ? update(v) : v,
    )

  /** Stops a poll on its way (it would bring back what is about to change), and clears older refusals. */
  const beforeChange = () => {
    void client.cancelQueries({ queryKey: ['image-takes', id] })
    for (const mutation of [make, choose, drop, unchoose]) mutation.reset()
  }
  const onChoose = (n: number) => {
    const before = chosen?.n ?? null
    beforeChange()
    // The page shows the choice at once; a refusal puts it back when the takes are read again.
    set((v) => ({
      ...v,
      takes: v.takes.map((t) => ({ ...t, chosen: t.n === n, isNew: t.n === n ? false : t.isNew })),
    }))
    setWasChosen(before)
    setRight(before ?? rightAfterDrop(strip, n))
    // Focus is asked for once the save has settled: asked earlier, it would be given to the button
    // just before the button is switched off, and the browser drops it from a disabled button.
    const focus = before !== null || strip.length > 1 ? 'choose' : 'right'
    choose.mutate(n, {
      onSuccess: () => setSaved((count) => count + 1),
      onSettled: () => setPendingFocus(focus),
    })
  }
  const onDrop = (n: number) => {
    const next = rightAfterDrop(strip, n)
    beforeChange()
    set((v) => ({ ...v, takes: v.takes.filter((t) => t.n !== n) }))
    setRight(next)
    drop.mutate(n, { onSettled: () => setPendingFocus(next ?? 'right') })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target
    if (
      target instanceof HTMLSelectElement ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
      return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const next = stepRight(strip, onRight, event.key === 'ArrowLeft' ? -1 : 1)
      event.preventDefault()
      if (next !== null) setRight(next)
    }
  }

  const controls = (
    <>
      <select
        className="takes-model"
        aria-label="Model for new takes"
        value={model}
        disabled={busy || make.isPending || !generator.ok}
        onChange={(event) => {
          setPicked(event.target.value as ImageModelId)
          setModelOpen(false)
        }}
        {...openTracking(setModelOpen)}
      >
        {IMAGE_MODEL_IDS.map((id) => (
          // The closed menu shows the label; the open list shows each entry in full.
          <option
            key={id}
            value={id}
            label={id === model && !modelOpen ? imageShortEntry(id) : undefined}
            disabled={!installed[id]}
          >
            {imageMenuEntry(id, states[id])}
          </option>
        ))}
      </select>
      <select
        className="takes-count"
        aria-label="Number of new takes"
        value={count}
        disabled={busy || make.isPending || !generator.ok}
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
          // The button is off while takes are made, and the browser drops focus from it; focus
          // goes to the take on the right in the strip, so ← and → keep stepping it.
          setPendingFocus(onRight ?? 'right')
          make.mutate({ count, model })
          setCount(2)
        }}
      >
        {makeTakesText(count, !none)}
      </button>
    </>
  )
  const problem =
    refusal(make.data) ?? refusal(choose.data) ?? refusal(drop.data) ?? refusal(unchoose.data)
  const error = make.error ?? choose.error ?? drop.error ?? unchoose.error ?? stop.error

  return (
    <>
      {!generator.ok && (
        <div className="errbox" role="alert">
          <div className="errbox-text">
            <strong>Images can&apos;t be made yet.</strong>
            <span className="muted small">
              Neither image model can run on this computer. Setup says what is missing.
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
            disabled={make.isPending || !generator.ok}
            onClick={() => make.mutate({ retry: f.n })}
          >
            Try again
          </button>
        </div>
      ))}
      <section className="panel takes-panel image-takes" aria-label="Takes" onKeyDown={onKeyDown}>
        <div className="takes-head">
          <h2>Takes</h2>
          {!none && (
            <div className="takes-controls">
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
              {controls}
            </div>
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
        {lockUnread && !none && (
          <span className="takes-missing small">
            Choosing, dropping and un-choosing wait until the images lock can be read. You can still
            look and make more takes.
          </span>
        )}
        <div className="image-stage">
          <div className="image-side" data-side="left">
            {asking && chosen ? (
              <Confirm
                title={`Un-choose take ${chosen.n}?`}
                effects={[]}
                note={unchooseNote(chosen.n)}
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
                        setAsking(false)
                        if (answer.ok) focusLeft()
                        else refocusUnchoose()
                      },
                      onError: () => {
                        setAsking(false)
                        refocusUnchoose()
                      },
                    })
                  }
                >
                  {unchoose.isPending ? 'Un-choosing…' : 'Un-choose'}
                </button>
              </Confirm>
            ) : (
              <LeftSide
                row={row}
                chosen={chosen}
                lockUnread={lockUnread}
                heading={leftHeading}
                opener={unchooseButton}
                unchoosing={unchoose.isPending}
                saving={choose.isPending}
                saved={saved}
                onUnchoose={() => {
                  unchoose.reset()
                  setAsking(true)
                }}
                size={size}
                id={id}
                lookError={lookError}
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
                  <span className="grow" />
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={lockUnread || drop.isPending || choose.isPending}
                    onClick={() => onDrop(rightTake.n)}
                  >
                    Drop
                  </button>
                  <button
                    type="button"
                    ref={chooseButton}
                    className="btn btn-primary btn-small"
                    disabled={
                      lockUnread ||
                      choose.isPending ||
                      drop.isPending ||
                      lookError !== null ||
                      rightTake.look === 'bringing'
                    }
                    onClick={() => onChoose(rightTake.n)}
                  >
                    Choose
                  </button>
                </>
              ) : (
                <b>{chosen ? 'No other takes yet' : 'No takes yet'}</b>
              )}
            </div>
            {rightTake && lookError !== null && (
              <span className="faint small">
                Fix the game&apos;s style file to choose this take.
              </span>
            )}
            {rightTake ? (
              <TakePair id={id} take={rightTake} row={row} lookError={lookError} />
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
        {strip.length > 0 || making.length > 0 ? (
          <div className="image-strip" data-strip>
            {takes
              .filter((t) => !t.chosen)
              .map((t) => (
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
                  <Picture
                    src={`/api/images/${encodeURIComponent(id)}/takes/${t.n}`}
                    alt=""
                    width={t.width}
                    height={t.height}
                  />
                  <span className="image-thumb-label">
                    <span className="grow">Take {t.n}</span>
                    {t.earlier && <span className="faint">earlier words</span>}
                    {t.n === wasChosen && <span className="faint">was chosen</span>}
                    {t.isNew && <span className="chip chip-new">new</span>}
                  </span>
                </button>
              ))}
            {making.map((m) => (
              <MakingThumb key={m.n} making={m} {...size} />
            ))}
          </div>
        ) : null}
        {strip.length > 0 && (
          <span className="faint small">
            Press a take, or use <kbd>←</kbd> <kbd>→</kbd>, to put it beside the chosen one.
          </span>
        )}
        {none && (
          <div className="takes-empty">
            <strong>Each take is a new image made from the prompt.</strong>
            <span className="muted">
              Make a few, compare them, and choose the one the game shows.
            </span>
            <div className="takes-make">{controls}</div>
          </div>
        )}
        {problem && <span className="adopt-error">{problem}</span>}
        {error && <span className="adopt-error">{error.message}</span>}
      </section>
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
          <span className="grow" />
          <button
            type="button"
            ref={opener}
            className="btn btn-small"
            disabled={lockUnread || unchoosing}
            onClick={onUnchoose}
          >
            Un-choose
          </button>
        </div>
        <TakePair
          id={id}
          take={chosen}
          row={row}
          lookError={lookError}
          current
          saving={saving}
          saved={saved}
        />
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

/** A take waiting or being made, in the strip: its place, its time and a progress bar. */
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
      <span className="faint small">{timeLeftText(making)}</span>
      <div className="bar" role="progressbar" aria-label={`Take ${making.n}`}>
        <i style={{ width: `${Math.round(progressOf(making) * 100)}%` }} />
      </div>
    </div>
  )
}
