import { EFFECTS_LOCK_UNREAD } from '../../effectsText'
import { off } from '../../off'
import { useEffect, useId, type ReactNode } from 'react'
import { effectCutLine } from '../../../core/effectTrim'
import type { EffectTakeView } from '../../../core/effectTakes'
import { NOTHING_LINE, SILENT_LINE, trimFailure } from '../../../core/musicTrim'
import { useTrimEffectTake } from '../../api'
import { useTrackActions } from '../../trackActions'

/** The tag beside a trimmed take's name. */
export function EffectTrimmedTag({ take }: { take: EffectTakeView }) {
  return take.trim ? <span className="take-tag">trimmed</span> : null
}

/**
 * Trim silence / Undo trim for an effect's take, in three parts for the card to place: the `button`
 * (null on an untrimmed take that cannot go into the game), `note` (the line under the
 * waveform: how much was cut, or why the button is greyed out) and `failure` (the red line, next to
 * the button), and `clear`, which the card calls when a later action on the take works, so the red
 * line never outlives the take it was about. The line is only ever about the take shown now, and goes
 * for good once another take (or none) is shown; a later action on the page hides it too (the page's
 * {@link TrackActions}, which this presses as a trim begins), except while the trim is still working:
 * its answer is still to come, and its failure to be said (`pending`).
 * `onPress` runs as a press begins, to stop a take that is playing, since its sound is about to
 * change.
 */
export function useEffectTrimControl({
  effect,
  take,
  inGame,
  locked,
  onPress,
}: {
  effect: string
  /** The take; none while the page does not know which take the game plays. */
  take: EffectTakeView | undefined
  /** The take is the one the game plays. */
  inGame: boolean
  /** The effects lock cannot be read: whether the take is in the game is not known, so Trim waits. */
  locked: boolean
  onPress: () => void
}): { button: ReactNode; note: ReactNode; failure: ReactNode; pending: boolean } {
  const trim = useTrimEffectTake(effect)
  const actions = useTrackActions()
  const noteId = useId()
  // Another take shown (or none), the old failure goes: it is never shown again, even when that take
  // comes back.
  const shown = take?.file
  const about = trim.variables?.file
  const pending = trim.isPending
  useEffect(() => {
    if (about !== undefined && about !== shown && !pending) trim.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, about, pending])
  const undo = take?.trim !== undefined
  // A trimmed take always keeps Undo trim; the studio says an untrimmed one has something to cut,
  // or why not, only when it can go into the game.
  if (!take || (!undo && !take.trimmable)) {
    return { button: null, note: null, failure: null, pending: trim.isPending }
  }
  const greyed = !undo && take.trimmable !== 'cut'
  const working = trim.isPending
  const note = take.trim
    ? effectCutLine(take.trim)
    : take.trimmable === 'nothing'
      ? NOTHING_LINE
      : take.trimmable === 'silent'
        ? SILENT_LINE
        : null
  // A failure about another take (the game now plays a different one) is not this take's.
  const reason =
    trim.variables?.file !== take.file || !actions.shows(`trim:${take.n}`)
      ? null
      : trim.isError
        ? trim.error.message
        : trim.data && !trim.data.ok
          ? 'message' in trim.data
            ? trim.data.message
            : `${trim.data.file} could not be read`
          : null
  return {
    pending: trim.isPending,
    button: (
      <button
        type="button"
        className="btn btn-small"
        {...off(
          locked && EFFECTS_LOCK_UNREAD,
          greyed && note,
          working && 'Wait for the trim to finish.',
        )}
        aria-describedby={note ? noteId : undefined}
        onClick={() => {
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
      reason !== null ? (
        <span className="adopt-error" role="alert">
          {trimFailure(take.n, reason, {
            inGame,
            undo: trim.variables?.undo ?? false,
            gameChanged: Boolean(trim.data && !trim.data.ok && 'gameChanged' in trim.data),
          })}
        </span>
      ) : null,
  }
}
