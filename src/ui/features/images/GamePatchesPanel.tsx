import { useRef, useState } from 'react'
import type { ImageRow, PatchRow } from '../../../core/images'
import { Problems } from '../../components/Problems'
import {
  patchSummary,
  type ImagePatchesView,
  type PatchTie,
  type PatchArea,
  type PatchWorkView,
} from '../../../core/imagePatches'
import { useImagePatchCompare, useImagePatches, useSetImagePatchWords } from '../../api'
import { PatchWorkbench } from './PatchWorkbench'
import { WordsField } from './WordsField'

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
  onSaved,
  onEdit,
}: {
  imageId: string
  patch: PatchRow
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
  onSaved: () => void
  onEdit: () => void
}) {
  const save = useSetImagePatchWords(imageId, patch.id)
  const compare = useImagePatchCompare(imageId, patch.id)
  const field = useRef<HTMLTextAreaElement>(null)
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
              disabled={compare.isPending}
              onClick={() => settle('game')}
            >
              Use the game&apos;s
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={compare.isPending}
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
      <WordsField
        label="What should change"
        words={patch.words}
        changed={patch.changed}
        save={save}
        onSaved={onSaved}
        onEdit={onEdit}
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
          view={view}
          work={work}
          words={words}
          mark={mark}
          onMark={onMark}
          onBackToArea={onBackToArea}
          tie={tie}
          imageSize={imageSize}
          game={game}
          onGame={onGame}
        />
      ) : (
        words
      )}
    </div>
  )
}

/** The named area a patch is tied to, with the place it has now; null for a patch with no tie. */
function tieOf(row: ImageRow, patch: PatchRow): PatchTie | null {
  const area = patch.area === undefined ? undefined : row.areas.find((a) => a.id === patch.area)
  return area ? { title: area.title, box: area.box } : null
}

/**
 * The patches the game asks for on an image, a list of titles that open in place to the words of
 * the edit, which can be reworded. Any number are open at once; a patch whose game words changed
 * under the user's opens by itself. Nothing on the page when the game asks for none.
 */
export function GamePatchesPanel({ row }: { row: ImageRow }) {
  const [saved, setSaved] = useState(false)
  const query = useImagePatches(row.id)
  // The marks the person made their own live here, not in the open patch, so closing and opening a row keeps them.
  const [marks, setMarks] = useState<Record<string, PatchArea>>({})
  // The box "What the game gets" of each patch lives here too; every box is ticked when the page opens.
  const [games, setGames] = useState<Record<string, boolean>>({})
  const view = query.data && 'patches' in query.data ? query.data : null
  const [open, setOpen] = useState(
    () => new Set(row.patches.filter((patch) => patch.gameChanged).map((patch) => patch.id)),
  )
  if (row.patches.length === 0) return null
  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <section className="panel game-patches" aria-label="Patches the game asks for">
      <div className="brief-panel-head">
        <h2>Patches the game asks for</h2>
        {saved && (
          <span className="saved" role="status">
            Saved
          </span>
        )}
      </div>
      <p className="muted game-patches-intro">
        Small changes the game lays over this image when it needs them.
      </p>
      <ul className="game-patch-list">
        {row.patches.map((patch) => {
          const isOpen = open.has(patch.id)
          const work = view?.patches.find((p) => p.id === patch.id) ?? null
          const summary = work ? patchSummary(work.takes) : null
          return (
            <li key={patch.id}>
              <button
                className="game-patch-row"
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(patch.id)}
              >
                <span className="game-patch-chev" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
                <span className="game-patch-words">
                  <b>{patch.title}</b>
                  <span className="mono muted">{patch.id}</span>
                  <span className="game-patch-end">
                    {patch.changed && (
                      <span className="game-patch-mark">
                        {patch.gameChanged ? 'the game changed its words' : 'changed here'}
                      </span>
                    )}
                    {summary && <span className="game-patch-summary">{summary.text}</span>}
                    {summary?.chip && <span className="chip chip-ok">{summary.chip}</span>}
                    {work?.oldLook && <span className="chip chip-warn">Old look</span>}
                  </span>
                </span>
              </button>
              {isOpen && (
                <PatchBody
                  imageId={row.id}
                  patch={patch}
                  view={view}
                  work={work}
                  mark={marks[patch.id] ?? null}
                  onMark={(area) => setMarks((now) => ({ ...now, [patch.id]: area }))}
                  onBackToArea={() => setMarks(({ [patch.id]: _own, ...others }) => others)}
                  tie={tieOf(row, patch)}
                  imageSize={row}
                  game={games[patch.id] ?? true}
                  onGame={(on) => setGames((now) => ({ ...now, [patch.id]: on }))}
                  onSaved={() => setSaved(true)}
                  onEdit={() => setSaved(false)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
