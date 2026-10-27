import type { LineState } from '../core/planner'
import { displayName } from '../core/summary'

/** A line an orphaned cue can be given to, as the picker lists it. */
export interface CueTarget {
  key: string
  /** Its place in the dialog, speaker and words: "12. Mira: Come in, child." */
  label: string
}

/** How much of a line's words the picker shows. */
const WORDS = 70

/**
 * The lines an orphaned cue can be given to: those without their own cue, numbered as in the
 * dialog (so lines with the same words can be told apart). Lines without a clip come first, as a
 * reworded line has none yet; when there is just one, it is the likely one and is suggested.
 */
export function cueTargets(lines: LineState[]): {
  fresh: CueTarget[]
  recorded: CueTarget[]
  suggested: string | null
} {
  const free = lines
    .map((line, i) => ({ line, place: i + 1 }))
    .filter(({ line }) => line.cueFrom !== 'own')
  const target = ({ line, place }: { line: LineState; place: number }): CueTarget => {
    const words = line.text.length > WORDS ? `${line.text.slice(0, WORDS)}…` : line.text
    return { key: line.key, label: `${place}. ${displayName(line.speaker)}: ${words}` }
  }
  const fresh = free.filter(({ line }) => line.file === null).map(target)
  const recorded = free.filter(({ line }) => line.file !== null).map(target)
  return { fresh, recorded, suggested: fresh.length === 1 ? fresh[0]!.key : null }
}

/** What the cue editor says of a line whose voice's model for a stage would speak a cue: none is sent. */
export function unspokenCueNote(line: LineState): string | null {
  switch (line.unspokenCues) {
    case 'both':
      return 'This voice’s ElevenLabs models speak cues aloud, so the line is recorded without them.'
    case 'draft':
      return 'This voice’s ElevenLabs draft model speaks cues aloud, so its drafts are recorded without them.'
    case 'final':
      return 'This voice’s ElevenLabs final model speaks cues aloud, so its final recording is made without them.'
    default:
      return null
  }
}
