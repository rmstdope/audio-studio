import { useEffect, useRef, useState } from 'react'
import { makeAgainOf, overlappingPatches, tieOf } from '../../../core/imagePatches'
import type { ImageRow, PatchRow } from '../../../core/images'
import { off } from '../../off'
import { WAIT_FOR_CHANGE } from '../../imagesText'
import { Problems } from '../../components/Problems'
import {
  makeAgainOpenLine,
  OVERLAP_EXPLANATION,
  overlapHeading,
  overlapOpenLine,
  overlapPairLine,
} from '../../imagesText'
import {
  type ImagePatchesView,
  type PatchTie,
  type PatchArea,
  type PatchWorkView,
} from '../../../core/imagePatches'
import { useImagePatchCompare, useImagePatches, useSetImagePatchWords } from '../../api'
import { startEditModel, type EditModelId } from '../../../core/imageModels'
import { progressOf } from '../../musicTakesText'
import { rowFailed, rowMaking } from '../../remakeText'
import { patchChosen, patchesHeading, patchLayoutOf, patchStateText } from '../../imageJobs'
import { patchRowId, RemakeLine } from './RemakeLine'
import { PatchWorkbench } from './PatchWorkbench'
import { WordsField, type SaveWordsNow } from './WordsField'

/**
 * One open patch: the notice when the game changed its words under the user's, then the field of
 * words, which behaves as the image's own: saved when left, the game's words one click away.
 */
function PatchBody({
  imageId,
  patch,
  view,
  work,
  mark,
  onMark,
  onBackToArea,
  tie,
  imageSize,
  game,
  onGame,
  model,
  onModel,
  onSaved,
  onEdit,
  makeAgainLine,
  overlapLine,
}: {
  imageId: string
  patch: PatchRow
  /** Where the patch was chosen and how to get it back, when it needs making again. */
  makeAgainLine: string | null
  /** What the patch's chosen take overlaps, or null when it overlaps nothing. */
  overlapLine: string | null
  /** The image's patches with their takes, once they have been loaded. */
  view: ImagePatchesView | null
  work: PatchWorkView | null
  /** The mark the person made their own; none while the patch starts from its named area. */
  mark: PatchArea | null
  onMark: (area: PatchArea) => void
  onBackToArea: () => void
  /** The named area the game ties the patch to, with its place; none for a patch with no tie. */
  tie: PatchTie | null
  imageSize: { width: number; height: number }
  game: boolean
  onGame: (on: boolean) => void
  /** The model new takes are made with, and its change; the page keeps the pick. */
  model: EditModelId
  onModel: (model: EditModelId) => void
  onSaved: () => void
  onEdit: () => void
}) {
  const save = useSetImagePatchWords(imageId, patch.id)
  const compare = useImagePatchCompare(imageId, patch.id)
  const field = useRef<HTMLTextAreaElement>(null)
  const saveNow = useRef<SaveWordsNow>(null)
  const settle = (choice: 'keep' | 'game') =>
    compare.mutate(choice, {
      onSuccess: (result) => {
        if (result.ok) field.current?.focus()
      },
    })
  const notice = (
    <>
      {patch.gameChanged && (
        <section
          className="notice notice-warn images-compare"
          aria-label="The game's words changed"
        >
          <div className="notice-text">
            <strong>The game changed this patch&apos;s words since you wrote your own.</strong>
            <div className="images-cmp">
              <div>
                <span className="label">Your words (used now)</span>
                <div className="images-ro">{patch.words}</div>
              </div>
              <div>
                <span className="label">The game&apos;s new words</span>
                <div className="images-ro">{patch.description}</div>
                <span className="muted">Before: {patch.gameWas}</span>
              </div>
            </div>
          </div>
          <div className="notice-actions">
            <button
              className="btn"
              type="button"
              {...off(compare.isPending && WAIT_FOR_CHANGE)}
              onClick={() => settle('game')}
            >
              Use the game&apos;s
            </button>
            <button
              className="btn btn-primary"
              type="button"
              {...off(compare.isPending && WAIT_FOR_CHANGE)}
              onClick={() => settle('keep')}
            >
              Keep mine
            </button>
            {compare.isError && <span className="adopt-error">{compare.error.message}</span>}
            {compare.data && !compare.data.ok && 'problems' in compare.data && (
              <Problems title="Could not be settled" problems={compare.data.problems} />
            )}
          </div>
        </section>
      )}
    </>
  )
  const words = (
    <>
      {overlapLine && <div className="line-warn">{overlapLine}</div>}
      {makeAgainLine && <div className="make-again-line">{makeAgainLine}</div>}
      <WordsField
        label="What should change"
        words={patch.words}
        changed={patch.changed}
        save={save}
        onSaved={onSaved}
        onEdit={onEdit}
        saveNow={saveNow}
        inputRef={field}
      />
      {patch.changed && <span className="muted">The game&apos;s words: {patch.description}</span>}
    </>
  )
  return (
    <div className="game-patch-body">
      {notice}
      {view && work ? (
        <PatchWorkbench
          imageId={imageId}
          patchId={patch.id}
          title={patch.title}
          view={view}
          work={work}
          words={words}
          saveWords={() => saveNow.current?.() ?? null}
          mark={mark}
          onMark={onMark}
          onBackToArea={onBackToArea}
          tie={tie}
          imageSize={imageSize}
          game={game}
          onGame={onGame}
          model={model}
          onModel={onModel}
        />
      ) : (
        <>
          <h3 className="patch-title">{patch.title}</h3>
          {words}
        </>
      )}
    </div>
  )
}

/**
 * The patches the game asks for on an image, laid out by the image's shape: a list beside a
 * portrait image, a row of chips above any other. One patch is open at a time, the first whose
 * game words changed under the user's, else the first. Nothing on the page when the game asks for
 * none.
 */
export function GamePatchesPanel({ row }: { row: ImageRow }) {
  const [saved, setSaved] = useState(false)
  const query = useImagePatches(row.id)
  // The marks the person made their own live here, not in the open patch, so switching patches keeps them.
  const [marks, setMarks] = useState<Record<string, PatchArea>>({})
  // The box "What the game gets" of each patch lives here too; every box is ticked when the page opens.
  const [games, setGames] = useState<Record<string, boolean>>({})
  // The model picked in each patch's menu: not remembered past the page, so each starts on klein (`startEditModel`).
  const [picks, setPicks] = useState<Record<string, EditModelId>>({})
  const [remakePick, setRemakePick] = useState<EditModelId | null>(null)
  const view = query.data && 'patches' in query.data ? query.data : null
  // An unread lock gives no take as chosen, so no patch is said to need making again.
  const again = new Set(view?.lockUnread ? [] : makeAgainOf(row).map((patch) => patch.id))
  const [openPick, setOpenId] = useState<string | null>(
    () => row.patches.find((patch) => patch.gameChanged)?.id ?? null,
  )
  // A patch named in the press's summary opens and its pick scrolls into view once it is there.
  const [reveal, setReveal] = useState<string | null>(null)
  useEffect(() => {
    if (reveal === null) return
    document.getElementById(patchRowId(reveal))?.scrollIntoView?.({ block: 'nearest' })
    setReveal(null)
  }, [reveal])
  if (row.patches.length === 0) return null
  const patch = row.patches.find((p) => p.id === openPick) ?? row.patches[0]!
  const openId = patch.id
  // Nothing is said until the patches are loaded, nor when the chosen picture or the lock cannot be read.
  const pairs = view && !view.pictureGone && !view.lockUnread ? overlappingPatches(row.patches) : []
  const overlapsOf = (id: string) =>
    pairs.flatMap(([a, b]) => (a.id === id ? [b.title] : b.id === id ? [a.title] : []))
  const overlapLineOf = (id: string) => {
    const titles = overlapsOf(id)
    return titles.length > 0 ? overlapOpenLine(titles) : null
  }
  const lockUnread = view?.lockUnread === true
  const heading = patchesHeading(row, lockUnread)
  const list = patchLayoutOf(row) === 'list'
  const workOf = (id: string) => view?.patches.find((p) => p.id === id) ?? null
  const pick = (p: PatchRow) => {
    const work = workOf(p.id)
    return (
      <li key={p.id}>
        <button
          id={patchRowId(p.id)}
          className={list ? 'patch-pick patch-pick-row' : 'patch-pick pchip'}
          type="button"
          title={list ? undefined : p.id}
          aria-current={p.id === openId ? 'true' : undefined}
          onClick={() => setOpenId(p.id)}
        >
          {list ? (
            <>
              <span className="patch-pick-top">
                <b>{p.title}</b>
                {p.changed && (
                  <span className="game-patch-mark">
                    {p.gameChanged ? 'the game changed its words' : 'changed here'}
                  </span>
                )}
                {work?.takes.some((t) => t.isNew) && <span className="chip chip-new">new</span>}
              </span>
              <span className="mono muted">{p.id}</span>
              {again.has(p.id) && <span className="chip chip-warn">Make again</span>}
              {work && (
                <span className="patch-pick-state">
                  {work.making.length > 0 ? (
                    <span className="game-patch-summary">
                      <span className="bar game-patch-bar" aria-hidden="true">
                        <i style={{ width: `${Math.round(progressOf(work.making[0]!) * 100)}%` }} />
                      </span>{' '}
                      {rowMaking(work.making)}
                    </span>
                  ) : (
                    <span className={`chip ${work.takes.some((t) => t.chosen) ? 'chip-ok' : ''}`}>
                      {patchStateText(work.takes)}
                    </span>
                  )}
                  {rowFailed(work.failed.length) && (
                    <span className="game-patch-summary">{rowFailed(work.failed.length)}</span>
                  )}
                  {work.oldLook && <span className="chip chip-warn">Old look</span>}
                </span>
              )}
            </>
          ) : (
            <>
              {!lockUnread && (
                <span className={`dot${patchChosen(row, p) ? ' ok' : ''}`} aria-hidden="true" />
              )}
              {p.title}
              {again.has(p.id) && <span className="chip chip-warn">Make again</span>}
            </>
          )}
        </button>
      </li>
    )
  }
  return (
    <section className="panel game-patches" aria-label="Patches the game asks for">
      <h2 className="sr-only">Patches the game asks for</h2>
      {saved && (
        <span className="saved" role="status">
          Saved
        </span>
      )}
      {pairs.length > 0 && (
        <section className="notice notice-warn" aria-label="Overlapping patches">
          <div className="notice-text">
            <strong>{overlapHeading(pairs.map(([a, b]) => [a.title, b.title]))}</strong>
            {pairs.length > 1 && (
              <ul className="overlap-pairs">
                {pairs.map(([a, b]) => (
                  <li key={`${a.id}\0${b.id}`}>{overlapPairLine([a.title, b.title])}</li>
                ))}
              </ul>
            )}
            <p className="muted">{OVERLAP_EXPLANATION}</p>
          </div>
        </section>
      )}
      {view && (
        <RemakeLine
          row={row}
          view={view}
          marks={marks}
          model={remakePick ?? startEditModel(view.models)}
          onModel={setRemakePick}
          onOpen={(id) => {
            setOpenId(id)
            setReveal(id)
          }}
        />
      )}
      <div className={list ? 'patches-layout patches-lefty' : 'patches-layout'}>
        {list ? (
          <div className="patches-side">
            <h3>{heading}</h3>
            <ul className="patches-list">{row.patches.map(pick)}</ul>
          </div>
        ) : (
          <div className="patches-chips">
            <span className="label">{heading}</span>
            <ul className="patches-chips-list">{row.patches.map(pick)}</ul>
          </div>
        )}
        <PatchBody
          key={patch.id}
          imageId={row.id}
          patch={patch}
          view={view}
          work={workOf(patch.id)}
          mark={marks[patch.id] ?? null}
          onMark={(area) => setMarks((now) => ({ ...now, [patch.id]: area }))}
          onBackToArea={() => setMarks(({ [patch.id]: _own, ...others }) => others)}
          tie={tieOf(row, patch)}
          imageSize={row}
          game={games[patch.id] ?? true}
          onGame={(on) => setGames((now) => ({ ...now, [patch.id]: on }))}
          model={picks[patch.id] ?? startEditModel(view?.models ?? {})}
          onModel={(model) => setPicks((now) => ({ ...now, [patch.id]: model }))}
          onSaved={() => setSaved(true)}
          onEdit={() => setSaved(false)}
          overlapLine={overlapLineOf(patch.id)}
          makeAgainLine={
            again.has(patch.id) ? makeAgainOpenLine(patch.chosenOn, row.chosenTake) : null
          }
        />
      </div>
    </section>
  )
}
