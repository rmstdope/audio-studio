import { useId, type ReactNode } from 'react'
import { effectCutLine } from '../../../core/effectTrim'
import type { EffectTakeView } from '../../../core/effectTakes'
import { NOTHING_LINE, SILENT_LINE, trimFailure } from '../../../core/musicTrim'
import { useTrimEffectTake } from '../../api'

/** The tag beside a trimmed take's name. */
export function EffectTrimmedTag({ take }: { take: EffectTakeView }) {
  return take.trim ? <span className="take-tag">trimmed</span> : null
}

/**
 * Trim silence / Undo trim for an effect's take, in three parts for the card to place: the `button`
 * (null on an untrimmed take that cannot go into the game), `note` (the line under the
 * waveform: how much was cut, or why the button is greyed out) and `failure` (the red line, next to
 * the button). `onPress` runs as a press begins, to stop a take that is playing, since its sound is
 * about to change.
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
}): { button: ReactNode; note: ReactNode; failure: ReactNode } {
  const trim = useTrimEffectTake(effect)
  const noteId = useId()
  const undo = take?.trim !== undefined
  // A trimmed take always keeps Undo trim; the studio says an untrimmed one has something to cut,
  // or why not, only when it can go into the game.
  if (!take || (!undo && !take.trimmable)) {
    return { button: null, note: null, failure: null }
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
  const reason = trim.isError
    ? trim.error.message
    : trim.data && !trim.data.ok
      ? 'message' in trim.data
        ? trim.data.message
        : `${trim.data.file} could not be read`
      : null
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
          {trimFailure(take.n, reason, { inGame, undo: trim.variables?.undo ?? false })}
        </span>
      ) : null,
  }
}
