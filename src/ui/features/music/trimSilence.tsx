import { useId, type ReactNode } from 'react'
import type { TakeView } from '../../../core/musicTake'
import {
  NOTHING_LINE,
  SILENT_LINE,
  cutLine,
  preciseClock,
  trimFailure,
} from '../../../core/musicTrim'
import { useTrimTake } from '../../api'
import { clock } from '../../format'
import { useTrackActions } from './trackActions'

/** Where a take's sound is: for a trimmed take, only the part between its cuts. */
export function takeSoundUrl(trackId: string, take: TakeView): string {
  const base = `/api/music/tracks/${encodeURIComponent(trackId)}/takes/${take.file}`
  return take.trim ? `${base}?trimmed=1` : base
}

/** How long a take plays: the part between its cuts if it is trimmed, else all of it, in seconds. */
export function playedSeconds(take: Pick<TakeView, 'trim' | 'seconds'>): number {
  return take.trim ? take.trim.seconds : take.seconds
}

/** A trimmed take's length as m:ss.s, an untrimmed take's as m:ss. */
export function takeLength(take: TakeView): string {
  return take.trim ? preciseClock(take.trim.seconds) : clock(take.seconds)
}

/** The share of a take's waveform, 0 to 1, cut away at each end; null for a take not trimmed. */
export function cutShares(
  take: Pick<TakeView, 'trim' | 'seconds'>,
): { start: number; end: number } | null {
  if (!take.trim || take.seconds <= 0) return null
  return { start: take.trim.start / take.seconds, end: take.trim.end / take.seconds }
}

/**
 * Maps how far into the part between the cuts a trimmed take has played (0 to 1) to where that is
 * on the full-width waveform; a take not trimmed plays as it is.
 */
export function wavePosition(
  take: Pick<TakeView, 'trim' | 'seconds'>,
  position: () => number | null,
): () => number | null {
  const cut = cutShares(take)
  if (!cut) return position
  return () => {
    const at = position()
    return at === null ? null : cut.start + at * (1 - cut.start - cut.end)
  }
}

/** The tag beside a trimmed take's name. */
export function TrimmedTag({ take }: { take: TakeView }) {
  return take.trim ? <span className="take-tag">trimmed</span> : null
}

/**
 * Trim silence / Undo trim for a stinger's take, in three parts for the card to place: the
 * `button` (null on a loop's take), `note` (the line under the waveform: how much was cut, or why
 * the button is greyed out) and `failure` (the red line, next to the button). `onPress` runs as a
 * press begins, to stop a take that is playing, since its sound is about to change.
 */
export function useTrimControl({
  trackId,
  take,
  inGame,
  locked,
  onPress,
}: {
  trackId: string
  /** The take; none while the page does not know which take the game plays. */
  take: TakeView | undefined
  /** The take is the one the game plays. */
  inGame: boolean
  /** The music lock cannot be read: whether the take is in the game is not known, so Trim waits, as Choose does. */
  locked: boolean
  onPress: () => void
}): { button: ReactNode; note: ReactNode; failure: ReactNode } {
  const trim = useTrimTake(trackId)
  const actions = useTrackActions()
  const noteId = useId()
  if (!take || (!take.trim && !take.trimmable)) return { button: null, note: null, failure: null }
  const undo = take.trim !== undefined
  const greyed = !undo && take.trimmable !== 'cut'
  const working = trim.isPending
  const text = undo
    ? null
    : take.trimmable === 'nothing'
      ? NOTHING_LINE
      : take.trimmable === 'silent'
        ? SILENT_LINE
        : null
  const reason = trim.isError
    ? trim.error.message
    : trim.data && !trim.data.ok
      ? 'message' in trim.data
        ? trim.data.message
        : `${trim.data.file} could not be read`
      : null
  const note = undo ? cutLine(take.trim!) : text
  return {
    button: (
      <button
        type="button"
        className="btn btn-small"
        disabled={greyed || locked}
        // Not `disabled` while it works: that would take the keyboard focus off the button.
        aria-disabled={working ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        onClick={() => {
          if (working) return
          onPress()
          actions.press(`trim:${take.n}`)
          trim.mutate({ file: take.file, undo })
        }}
      >
        {working ? 'Trimming…' : undo ? 'Undo trim' : 'Trim silence'}
      </button>
    ),
    note: note ? (
      <span className="faint small" id={noteId}>
        {note}
      </span>
    ) : null,
    failure:
      reason !== null && actions.shows(`trim:${take.n}`) ? (
        <span className="adopt-error" role="alert">
          {trimFailure(take.n, reason, { inGame, undo: trim.variables?.undo ?? false })}
        </span>
      ) : null,
  }
}
