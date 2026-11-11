import { EditModelMenu } from './EditModelMenu'
import { EDIT_SETUP_LINE, editModel, type EditModelId } from '../../../core/imageModels'
import { useEffect, useRef, useState } from 'react'
import { planRemake, remakeCovered, tieOf, type ImagePatchesView } from '../../../core/imagePatches'
import type { ImageRow, PatchRow } from '../../../core/images'
import type { PatchArea } from '../../../core/imagePatches'
import { useCloseRemake, useRemakePatches, useStopRemake } from '../../api'
import { off } from '../../off'
import { modelMissingWhy, WAIT_FOR_CHANGE } from '../../imagesText'
import { useStopFocus } from '../../components/useStopFocus'
import {
  leftOutLine,
  REMAKE_USES,
  remakeProgress,
  remakeSentence,
  remakeSummary,
} from '../../remakeText'

/** The id of a patch's row button, where focus goes after Close. */
export const patchRowId = (id: string) => `game-patch-row-${id}`

/**
 * The line under "Patches the game asks for": one press that remakes every patch marked "Make
 * again" that has no takes on the take in the game (1 to 4 each), the progress of that press with
 * Stop, then its summary until Close. Nothing is chosen by it and nothing reaches the game.
 */
export function RemakeLine({
  row,
  view,
  marks,
  model,
  onModel,
  onOpen,
}: {
  row: ImageRow
  view: ImagePatchesView
  /** The marks the person drew, by patch id. */
  marks: Record<string, PatchArea>
  /** The model the press makes its takes with, picked in its own menu (the page keeps the pick). */
  model: EditModelId
  onModel: (model: EditModelId) => void
  /** Opens a patch's row and scrolls to it. */
  onOpen: (id: string) => void
}) {
  const [count, setCount] = useState(2)
  const [failed, setFailed] = useState(false)
  const [land, setLand] = useState<'stop' | 'close' | null>(null)
  const make = useRemakePatches(row.id)
  const stop = useStopRemake(row.id)
  const close = useCloseRemake(row.id)
  const stopButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const press = view.remake.press
  const stopFocus = useStopFocus(press?.running ?? false, () => setLand('close'))
  useEffect(() => {
    // A press that ended before its Stop was ever shown leaves nothing to focus.
    if (land === 'stop' && press && !press.running) {
      setLand(null)
      return
    }
    if (land === 'stop') stopButton.current?.focus()
    if (land === 'close') closeButton.current?.focus()
    if (land && (land === 'stop' ? stopButton.current : closeButton.current)) setLand(null)
  })

  if (press) {
    const titles = new Map(row.patches.map((p) => [p.id, p.title]))
    if (press.running) {
      return (
        <div className="remake-line">
          <span className="remake-grow" role="status">
            {remakeProgress(press.total, press.ids.length, press.left, press.model)}
          </span>
          <button
            ref={stopButton}
            className="btn"
            type="button"
            {...off(stop.isPending && WAIT_FOR_CHANGE)}
            {...stopFocus}
            onClick={() => stop.mutate()}
          >
            Stop
          </button>
        </div>
      )
    }
    const said = remakeSummary({ ...press, patches: press.ids.length })
    return (
      <div className="remake-line">
        <span className="remake-grow" role="status">
          {said.lead}
          {said.failed && (
            <>
              {' '}
              {said.failed.before}
              {press.failed.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <button type="button" className="link-button" onClick={() => onOpen(id)}>
                    {titles.get(id) ?? id}
                  </button>
                </span>
              ))}
              {said.failed.after(press.failed.length)}
            </>
          )}
        </span>
        <button
          ref={closeButton}
          className="btn"
          type="button"
          {...off(close.isPending && WAIT_FOR_CHANGE)}
          onClick={() =>
            close.mutate(undefined, {
              onSuccess: () => {
                // The first row the press made takes for, else the first it tried.
                const first =
                  press.ids.find((id) => view.patches.find((p) => p.id === id)?.takes.length) ??
                  press.ids[0]
                if (first) document.getElementById(patchRowId(first))?.focus()
              },
            })
          }
        >
          Close
        </button>
      </div>
    )
  }

  const covered: PatchRow[] = remakeCovered(row, view.patches)
  if (covered.length === 0) return null
  const plan = view.take
    ? planRemake(
        covered.map((patch) => ({
          id: patch.id,
          title: patch.title,
          mark: marks[patch.id] ?? null,
          tie: tieOf(row, patch),
          earlier: view.remake.earlier[patch.id] ?? null,
        })),
        row,
        view.take,
      )
    : { make: covered.map((p) => ({ id: p.id, title: p.title })), leftOut: [] }
  const modelHere = view.models[model] === 'whole'
  const blocked = view.pictureGone
    ? "The chosen take's picture is missing or cannot be read, so it cannot be patched."
    : view.maker.ok
      ? null
      : view.maker.message
  const left = leftOutLine(
    plan.leftOut.map((p) => p.title),
    plan.make.length === 0,
  )
  if (plan.make.length === 0 && plan.leftOut.length > 0) {
    return <p className="remake-leftout muted">{left}</p>
  }
  const remake = () => {
    setFailed(false)
    make.mutate(
      { count, marks, model },
      {
        onSuccess: (answer) => (answer.ok ? setLand('stop') : setFailed(true)),
        onError: () => setFailed(true),
      },
    )
  }
  return (
    <div className="remake">
      <div className="remake-line">
        <span className="remake-grow">{remakeSentence(plan.make.length, row.chosenTake!)}</span>
        <EditModelMenu
          value={model}
          onChange={onModel}
          downloads={view.models}
          failed={view.remake.failedModels}
          label="Model for the new takes of each patch"
        />
        <select
          aria-label="Takes of each patch"
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'take' : 'takes'} each
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          type="button"
          {...off(
            blocked,
            !modelHere && modelMissingWhy(editModel(model).name),
            make.isPending && WAIT_FOR_CHANGE,
          )}
          onClick={remake}
        >
          Remake patches on this take
        </button>
      </div>
      {blocked && <span className="muted small">{blocked}</span>}
      {!modelHere && <span className="faint small">{EDIT_SETUP_LINE}</span>}
      <span className="faint small">{REMAKE_USES}</span>
      {plan.leftOut.length > 0 && <span className="faint small">{left}</span>}
      {failed && (
        <span className="adopt-error" role="alert">
          The takes could not be started. Nothing was made; try again.
        </span>
      )}
    </div>
  )
}
