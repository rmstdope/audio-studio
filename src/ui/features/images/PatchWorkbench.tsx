import { fieldOwnsKeys, usePendingFocus } from './useWorkbenchKeys'
import { useAfterSaved } from '../../useAfterSaved'
import { useJobOpen } from './ImageJobTabs'
import { FitPicture, pictureShape } from './FitPicture'
import { useFillWindow } from '../../fillWindow'
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
  markFromArea,
  type ImagePatchesView,
  type PatchTie,
  type PatchArea,
  type PatchMakingView,
  type PatchTakeView,
  type PatchWorkView,
} from '../../../core/imagePatches'
import { EDIT_SETUP_LINE, editModel, type EditModelId } from '../../../core/imageModels'
import { EditModelMenu } from './EditModelMenu'
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
import { off } from '../../off'
import { areaFromDrag, sameArea } from '../../imagePatchArea'
import {
  areaNoPlaceText,
  backToAreaText,
  BRINGING_WHY,
  IMAGES_LOCK_WHY,
  makeTakesText,
  STYLE_BROKEN_WHY,
  IMAGE_TAKE_UNKNOWN,
  modelCaption,
  modelMissingWhy,
  patchMakeWhy,
  patchMenuWhy,
  WAIT_FOR_CHANGE,
  markedFromAreaText,
  refusal,
  takeCountText,
} from '../../imagesText'
import { gameSpace, modelSpace, type PatchSpace } from '../../patchGameSpace'
import { tag } from './TakePicture'
import { failureLine, progressOf } from '../../musicTakesText'
import { imageTimeLeftText } from '../../imageTakesText'
import { closeUp, closeUpBox, closeUpLayer } from '../../patchCloseUp'
import { scrollWithin } from '../../scrollWithin'

/** How many takes one press can make. */
const MAX_AT_ONCE = 4

/** Where an area lies on a picture of this size, in the percentages the page draws with. */
function placed(area: PatchArea, take: { width: number; height: number }): CSSProperties {
  // A mark can reach past the part the game's version shows; it is drawn up to that picture's edge.
  const within = (at: number, size: number) => Math.min(Math.max(at, 0), size) / size
  const left = within(area.x, take.width)
  const top = within(area.y, take.height)
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(within(area.x + area.width, take.width) - left) * 100}%`,
    height: `${(within(area.y + area.height, take.height) - top) * 100}%`,
  }
}

/** The keys a patch hears when focus is inside it. */
const PATCH_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'c', 'd', 's'])

/** Where the pictures of a patch are, as the large view and the close-ups draw them. */
interface Sources {
  /** The image's chosen take. */
  base: string
  /** A take of the patch laid over it. */
  patch: (n: number, look: PatchTakeView['look']) => string | null
}

/** A close-up of a take: the image's take with the patch take laid over it, only the area joined with what the take keeps, and a little around it. */
function CloseUp({
  sources,
  space,
  look,
  n,
  area,
  kept,
}: {
  sources: Sources
  /** The picture it is cut from. */
  space: PatchSpace
  /** The state of the patch take's game version when the game's version is shown; ready otherwise. */
  look: PatchTakeView['look']
  /** The patch take laid over the picture; none shows the picture alone (a take still to be made). */
  n: number | null
  area: PatchArea
  /** The box round what the take keeps, in the model's pixels; none frames the area alone. */
  kept: PatchArea | null
}) {
  const crop = closeUp(space.place(area), space, kept && space.place(kept))
  const layer = closeUpLayer(crop, space)
  const over = n === null ? null : sources.patch(n, look)
  if (n !== null && over === null) {
    return <span className="patch-closeup patch-closeup-empty" style={closeUpBox(crop)} />
  }
  return (
    <span className="patch-closeup" style={closeUpBox(crop)}>
      <img
        src={sources.base}
        style={{ ...layer, imageRendering: 'pixelated' }}
        alt=""
        draggable={false}
      />
      {over && (
        <img
          src={over}
          style={{ ...layer, imageRendering: 'pixelated' }}
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
  space,
  imageId,
  patchId,
}: {
  making: PatchMakingView
  space: PatchSpace
  imageId: string
  patchId: string
}) {
  const crop = closeUp(space.place(making.area), space)
  return (
    <div className="patch-thumb patch-thumb-making">
      <span className="patch-closeup patch-closeup-empty" style={closeUpBox(crop)} />
      <span className="patch-thumb-label">
        <span className="grow">Take {making.n}</span>
      </span>
      <span className="faint small patch-thumb-model">{editModel(making.model).short}</span>
      <span className="faint small">{imageTimeLeftText(making)}</span>
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
  title,
  view,
  work,
  words,
  saveWords,
  mark,
  onMark,
  onBackToArea,
  tie,
  imageSize,
  game,
  onGame,
  model,
  onModel,
}: {
  imageId: string
  patchId: string
  /** The patch's title, as the game names it. */
  title: string
  view: ImagePatchesView
  work: PatchWorkView
  /** The patch's field of words. */
  words: ReactNode
  /** Sees the field of words saved: whether it was, or null with nothing to save. */
  saveWords: () => Promise<boolean> | null
  /** The mark the person made their own; none starts the patch from its named area, if it has one. */
  mark: PatchArea | null
  onMark: (area: PatchArea) => void
  /** Gives the mark back to the named area. */
  onBackToArea: () => void
  tie: PatchTie | null
  /** The image's size, the pixels its named areas are in. */
  imageSize: { width: number; height: number }
  /** Whether the game's version is shown (the box "What the game gets"), kept by the page. */
  game: boolean
  onGame: (on: boolean) => void
  /** The model new takes are made with, picked in the menu (the page keeps the pick). */
  model: EditModelId
  onModel: (model: EditModelId) => void
}) {
  const make = useMakePatchTakes(imageId, patchId)
  const stop = useStopPatchTakes(imageId, patchId)
  const choose = useChoosePatchTake(imageId, patchId)
  const drop = useDropPatchTake(imageId, patchId)
  const unchoose = useUnchoosePatchTake(imageId, patchId)
  const seen = useMarkPatchTakeSeen(imageId, patchId)
  const jobOpen = useJobOpen()
  const [looking, setLooking] = useState<number | null>(null)
  const [showing, setShowing] = useState(true)
  const [count, setCount] = useState(2)
  const [asking, setAsking] = useState(false)
  const focusOn = usePendingFocus<number | 'heading'>((want) =>
    want === 'heading' ? heading.current : thumbs.current.get(want),
  )
  const { waiting: waitingForWords, afterSaved: afterWordsSaved } = useAfterSaved(saveWords)
  // Focus goes to Make once a stopped press has left it free again.
  const [landOnMake, setLandOnMake] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fill = useFillWindow()
  const asked = useRef(new Set<number>())
  // A choice or drop asked for by a key and not yet settled: a second press waits for it.
  const changing = useRef(false)
  const heading = useRef<HTMLSpanElement>(null)
  const unchooseButton = useRef<HTMLButtonElement>(null)
  const makeButton = useRef<HTMLButtonElement>(null)
  const thumbs = useRef(new Map<number, HTMLButtonElement>())
  const refocusUnchoose = useFocusWhenClosed(asking, unchooseButton)

  const { take, lookError, lockUnread } = view
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
    if (jobOpen && shown?.isNew && !asked.current.has(shown.n)) {
      asked.current.add(shown.n)
      seen.mutate(shown.n)
    }
  })
  // The grid scrolls on its own: the take looked at is kept in view as ← and → step.
  useEffect(() => {
    const thumb = lookingAt === null ? undefined : thumbs.current.get(lookingAt)
    scrollWithin(thumb, thumb?.closest<HTMLElement>('.patch-thumbs'))
  }, [lookingAt])
  useEffect(() => {
    if (landOnMake && work.making.length === 0) {
      makeButton.current?.focus()
      setLandOnMake(false)
    }
  })

  if (!take) {
    return (
      <>
        <h3 className="patch-title">{title}</h3>
        {words}
        <span className="muted small">
          {view.pictureGone
            ? "The chosen take's picture is missing or cannot be read, so it cannot be patched."
            : view.lockUnread
              ? IMAGE_TAKE_UNKNOWN
              : 'Choose a take of the image first. Patches are painted onto the take the game shows.'}
        </span>
      </>
    )
  }

  const space = game ? gameSpace(take, view.game) : modelSpace(take)
  const version = tag(`${view.lookKey ?? ''}${take.n}`)
  const image = encodeURIComponent(imageId)
  const patch = encodeURIComponent(patchId)
  const sources: Sources = {
    base: game
      ? `/api/images/${image}/takes/${take.n}/game?v=${version}`
      : `/api/images/${image}/takes/${take.n}`,
    patch: (n, look) =>
      !game
        ? `/api/images/${image}/patches/${patch}/takes/${n}`
        : look === 'bringing' || look === 'missing'
          ? null
          : `/api/images/${image}/patches/${patch}/takes/${n}/game?v=${tag(`${view.lookKey ?? ''}${look}${n}`)}`,
  }
  // A mark that is not the person's own starts from the named area, so it follows the area.
  const fromArea = tie?.box ? markFromArea(tie.box, imageSize, take) : null
  const own = mark && !checkPatchArea(mark, take) ? mark : null
  const marked = own ?? fromArea
  const atArea = marked !== null && fromArea !== null && sameArea(marked, fromArea)
  const busy = making.length > 0
  const hasTakes = takes.length > 0 || busy
  const modelHere = view.models[model] === 'whole'
  const absentLine = modelHere ? null : EDIT_SETUP_LINE
  const menuWhy = patchMenuWhy({
    makerMessage: view.maker.ok ? null : view.maker.message,
    making: busy || make.isPending,
    savingWords: waitingForWords,
  })
  const makeWhy = patchMakeWhy({
    makerMessage: view.maker.ok ? null : view.maker.message,
    modelName: editModel(model).name,
    modelHere,
    mark: marked === null ? 'none' : 'placed',
    areaTitle: tie ? tie.title : null,
    making: busy || make.isPending,
    savingWords: waitingForWords,
  })
  const canChange = !lockUnread && !choose.isPending && !drop.isPending
  const changeWhy = lockUnread ? IMAGES_LOCK_WHY : WAIT_FOR_CHANGE
  const canChoose = canChange && lookError === null && shown !== null && shown.look !== 'bringing'
  const chooseWhy = !canChange ? changeWhy : lookError !== null ? STYLE_BROKEN_WHY : BRINGING_WHY
  const overlaid = showing ? shown : null
  const showMark = marked !== null && !(overlaid && sameArea(marked, overlaid.area))
  const problem = refusal(make.data) ?? refusal(choose.data) ?? refusal(drop.data)
  const error = make.error ?? choose.error ?? drop.error ?? stop.error
  // Un-choose answers beside its own button, and only while the chosen take is the one shown.
  const unchooseProblem = shown?.chosen
    ? (refusal(unchoose.data) ?? unchoose.error?.message)
    : undefined
  const beforeChange = () => {
    for (const mutation of [make, choose, drop, unchoose]) mutation.reset()
  }

  const onChoose = (n: number) => {
    beforeChange()
    changing.current = true
    choose.mutate(n, {
      onSettled: () => {
        changing.current = false
        focusOn(lookingAt ?? 'heading')
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
        focusOn(next ?? 'heading')
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
      space,
      space.unplace,
      take,
    )
    // A click, or a drag too small to patch, changes nothing.
    if (dragged) onMark(dragged)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (!PATCH_KEYS.has(event.key.toLowerCase()) && !PATCH_KEYS.has(event.key)) return
    // Keys typed into a field or menu are its own.
    if (fieldOwnsKeys(target)) return
    // The image's own keys rest while focus is inside a patch.
    event.stopPropagation()
    event.preventDefault()
    // The question open, the keys are heard and do nothing.
    if (asking) return
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
    if (key === 'c' && !shown.chosen && canChoose) onChoose(shown.n)
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
          {...off(unchoose.isPending && WAIT_FOR_CHANGE)}
          onClick={() =>
            unchoose.mutate(undefined, {
              onSuccess: (answer) => {
                if (answer.ok) focusOn(lookingAt ?? 'heading')
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
              <span className="faint small">{editModel(shown.model).short}</span>
              {shown.chosen && <span className="chip chip-ok">Chosen</span>}
              {shown.chosen && work.oldLook && <span className="chip chip-warn">Old look</span>}
            </>
          ) : (
            <span className="lbl" ref={heading} tabIndex={-1}>
              The chosen take of the image
            </span>
          )}
        </div>
        <FitPicture>
          {game &&
          (lookError !== null || shown?.look === 'bringing' || shown?.look === 'missing') ? (
            <div
              className={`look-empty fit-shape${lookError !== null ? ' look-empty-err' : ''}`}
              style={pictureShape(space.width, space.height)}
              role={lookError !== null ? 'alert' : 'status'}
            >
              {lookError !== null
                ? lookError
                : shown?.look === 'missing'
                  ? "Not brought to the game's look yet."
                  : "Bringing to the game's look…"}
            </div>
          ) : (
            <div
              className="patch-stage fit-shape"
              style={{
                ...pictureShape(space.width, space.height),
                ...(game ? ({ imageRendering: 'pixelated' } as CSSProperties) : {}),
              }}
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
                src={sources.base}
                alt="The chosen take of the image"
                draggable={false}
              />
              {overlaid && sources.patch(overlaid.n, overlaid.look) && (
                <img
                  className="patch-over"
                  src={sources.patch(overlaid.n, overlaid.look)!}
                  alt={`Take ${overlaid.n}`}
                  draggable={false}
                />
              )}
              {showMark && marked && (
                <div className="patch-mark" style={placed(space.place(marked), space)} />
              )}
            </div>
          )}
        </FitPicture>
        <span className="faint small">
          {game
            ? `${view.game.width} × ${view.game.height}`
            : modelCaption(take.width, take.height, take.cropped)}
        </span>
        {shown && (
          <div className="patch-controls">
            <button type="button" className="btn" onClick={() => setShowing((on) => !on)}>
              {showing ? 'Patch off' : 'Patch on'} <kbd>S</kbd>
            </button>
            {shown.chosen ? (
              <button
                type="button"
                className="btn"
                ref={unchooseButton}
                {...off(!canChange && changeWhy)}
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
                  {...off(!canChange && changeWhy)}
                  onClick={() => onDrop(shown.n)}
                >
                  Drop <kbd>D</kbd>
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  {...off(!canChoose && chooseWhy)}
                  onClick={() => onChoose(shown.n)}
                >
                  Choose <kbd>C</kbd>
                </button>
              </>
            )}
          </div>
        )}
        {unchooseProblem && <span className="adopt-error">{unchooseProblem}</span>}
        {shown && lookError !== null && (
          <span className="faint small">Fix the style to choose this take.</span>
        )}
      </>
    )

  const items = [
    ...takes.map((t) => ({ n: t.n, take: t, making: null as PatchMakingView | null })),
    ...making.map((m) => ({ n: m.n, take: null as PatchTakeView | null, making: m })),
  ].sort((a, b) => a.n - b.n)

  return (
    <div className="patch-bench" ref={fill} onKeyDown={onKeyDown}>
      <div className="patch-bench-left">{left}</div>
      <div className="patch-bench-right">
        <h3 className="patch-title">{title}</h3>
        {words}
        {tie &&
          (atArea ? (
            <span className="muted small">{markedFromAreaText(tie.title)}</span>
          ) : fromArea ? (
            <button
              type="button"
              className="patch-back"
              onClick={() => {
                onBackToArea()
                // Make may be off (no model, takes being made): focus then goes to the heading.
                if (
                  makeButton.current &&
                  makeButton.current.getAttribute('aria-disabled') !== 'true'
                )
                  makeButton.current.focus()
                else focusOn('heading')
              }}
            >
              {backToAreaText(tie.title)}
            </button>
          ) : (
            !marked && <span className="muted small">{areaNoPlaceText(tie.title)}</span>
          ))}
        <EditModelMenu
          value={model}
          onChange={onModel}
          downloads={view.models}
          failed={work.failedModels}
          label="Model for new takes"
          why={menuWhy}
        />
        <div className="patch-make">
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
            ref={makeButton}
            onClick={() => {
              if (!marked) return
              // The button is off while takes are made, and the browser drops focus from it; focus
              // goes to the take looked at in the grid, so ← and → keep stepping it.
              focusOn(lookingAt ?? 'heading', true)
              afterWordsSaved(() => make.mutate({ count, area: marked, model }))
            }}
          >
            {makeTakesText(count, hasTakes)}
          </button>
          {busy && (
            <button
              type="button"
              className="btn btn-ghost"
              {...off(stop.isPending && WAIT_FOR_CHANGE)}
              onClick={() => stop.mutate(undefined, { onSuccess: () => setLandOnMake(true) })}
            >
              Stop
            </button>
          )}
        </div>
        {absentLine && <span className="faint small">{absentLine}</span>}
        <span className="faint small patch-keys">
          <kbd>←</kbd> <kbd>→</kbd> take · <kbd>C</kbd> choose · <kbd>D</kbd> drop · <kbd>S</kbd>{' '}
          patch off/on
        </span>
        {!view.maker.ok ? (
          <span className="takes-missing small" role="status">
            {view.maker.message}
          </span>
        ) : (
          !marked &&
          !tie && (
            <span className="muted small">Drag over the picture to mark what should change.</span>
          )
        )}
        {problem && <span className="adopt-error">{problem}</span>}
        {error && <span className="adopt-error">{error.message}</span>}
      </div>
      <div className="patch-takes">
        <div className="patch-takes-head">
          <h3>{takes.length === 0 ? 'Takes' : `Takes · ${takes.length}`}</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={game}
              onChange={(event) => onGame(event.target.checked)}
            />
            What the game gets
          </label>
        </div>
        {/* A take that could not be made is told among the takes, which stay in view (as-2ida). */}
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
                !view.maker.ok && view.maker.message,
                view.models[f.model] !== 'whole' && modelMissingWhy(editModel(f.model).name),
                make.isPending && WAIT_FOR_CHANGE,
              )}
              onClick={() => make.mutate({ retry: f.n })}
            >
              Try again
            </button>
          </div>
        ))}
        {lockUnread && takes.length > 0 && (
          <span className="takes-missing small">
            Choosing, dropping and un-choosing wait until the images lock can be read. You can still
            look and make more takes.
          </span>
        )}
        {items.length === 0 ? (
          <div className="takes-empty">
            No takes yet. Each take is a new try at this change, painted with the part of the
            picture around the mark in view.
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
                      sources={sources}
                      space={space}
                      look={t.look}
                      n={n}
                      area={t.area}
                      kept={t.kept}
                    />
                    <span className="patch-thumb-label">
                      <span className="grow">Take {n}</span>
                      {t.chosen && <span className="chip chip-ok">Chosen</span>}
                      {t.isNew && <span className="chip chip-new">new</span>}
                      {t.earlier && <span className="faint small">earlier words</span>}
                    </span>
                    <span className="faint small patch-thumb-model">
                      {editModel(t.model).short}
                    </span>
                  </button>
                ) : (
                  <MakingThumb
                    key={n}
                    making={m!}
                    space={space}
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
    </div>
  )
}
