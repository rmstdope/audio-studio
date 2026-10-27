import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { MusicListSummary } from '../../../core/music'
import {
  NO_MATCH,
  filterTargets,
  moveFailure,
  moveLine,
  moveTargets,
  moveTitle,
} from '../../../core/musicMove'
import type { MakingSummary, TakeView } from '../../../core/musicTake'
import type { MoveResult } from '../../../services/musicTakes'
import { useMoveTake } from '../../api'

/**
 * The dialog that moves a take to another track of the same kind: a search box (loops only), the
 * tracks of the game to pick from, and the move. It stays open with the reason when the move is
 * refused. Esc and Cancel close it with nothing changed; `onMoved` hears the answer of a move done.
 */
export function MoveTakeDialog({
  trackId,
  trackTitle,
  kind,
  take,
  lists,
  making,
  onClose,
  onMoving,
  onMoved,
}: {
  trackId: string
  trackTitle: string
  kind: 'loop' | 'stinger'
  take: TakeView
  lists: readonly MusicListSummary[]
  making: Record<string, MakingSummary>
  onClose: () => void
  /** The move was pressed: a take that is playing stops. */
  onMoving: () => void
  onMoved: (to: { id: string; n: number }) => void
}) {
  const move = useMoveTake(trackId)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const { groups: all } = useMemo(
    () => moveTargets(lists, { id: trackId, kind }, making),
    [lists, trackId, kind, making],
  )
  const groups = filterTargets(all, query)
  const loops = kind === 'loop'
  const pending = move.isPending

  // A pick whose row has left the game's list is dropped, so Move is greyed until another is picked.
  useEffect(() => {
    if (selected && !all.some((group) => group.tracks.some((t) => t.id === selected)))
      setSelected(null)
  }, [all, selected])

  // Focus starts in the search box, or on the first row for stingers.
  useEffect(() => {
    if (loops) search.current?.focus()
    else
      root.current
        ?.querySelector<HTMLButtonElement>('button[role="option"]:not([disabled])')
        ?.focus()
  }, [loops])

  async function submit() {
    if (!selected || pending) return
    setFailure(null)
    onMoving()
    let answer: MoveResult
    try {
      answer = await move.mutateAsync({ file: take.file, to: selected })
    } catch (error) {
      // The server did not answer with a refusal: how far it got is not known, so it is not said
      // that nothing was changed.
      const why = error instanceof Error ? error.message : String(error)
      setFailure(`Take ${take.n} could not be moved: ${why}. Check the takes on both tracks.`)
      return
    }
    if (answer && answer.ok && 'n' in answer) onMoved({ id: selected, n: answer.n })
    else {
      const reason =
        answer && 'message' in answer
          ? answer.message
          : answer && 'file' in answer
            ? `${answer.file} could not be read`
            : 'That track is not in the game’s list.'
      setFailure(moveFailure(take.n, reason))
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!pending) onClose()
      return
    }
    const target = event.target as HTMLElement
    const onRow = target.getAttribute('role') === 'option'
    if (event.key === 'Enter' && (onRow || target === search.current)) {
      event.preventDefault()
      void submit()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    // The search box, then each row that can be picked, in the order drawn.
    const stops = [
      ...(loops && search.current ? [search.current as HTMLElement] : []),
      ...(root.current?.querySelectorAll<HTMLElement>('button[role="option"]:not([disabled])') ??
        []),
    ]
    const at = stops.indexOf(target)
    const next =
      stops[Math.max(0, Math.min(stops.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]
    if (!next) return
    next.focus()
    const id = next.dataset.track
    if (id) setSelected(id)
  }

  return (
    <div className="modal-back" onKeyDown={onKeyDown}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-take-title"
        ref={root}
      >
        <h3 id="move-take-title">{moveTitle(take.n, kind)}</h3>
        <span className="muted small">{moveLine(trackTitle, kind)}</span>
        {loops && (
          <input
            ref={search}
            className="filter"
            placeholder="Find a loop"
            aria-label="Find a loop"
            value={query}
            disabled={pending}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <div className="modal-list" role="listbox" aria-label="Where to move it">
          {groups.length === 0 && <div className="faint small modal-note">{NO_MATCH}</div>}
          {groups.map((group, index) => (
            <div className="group" key={group.heading ?? `group-${index}`}>
              {group.heading && <div className="label">{group.heading}</div>}
              {group.notListed && <div className="faint small modal-note">{group.notListed}</div>}
              {group.tracks.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  role="option"
                  data-track={target.id}
                  aria-selected={selected === target.id}
                  disabled={target.here || pending}
                  className={`dest${selected === target.id ? ' sel' : ''}${target.here ? ' off' : ''}`}
                  onClick={() => setSelected(target.id)}
                >
                  <span className="grow">
                    <span className="dest-title">{target.title}</span>
                    <span className="faint small dest-line">{target.line}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
        {failure && (
          <span className="adopt-error" role="alert">
            {failure}
          </span>
        )}
        <div className="modal-actions">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected || pending}
            onClick={() => void submit()}
          >
            {pending ? 'Moving…' : `Move take ${take.n}`}
          </button>
        </div>
      </div>
    </div>
  )
}
