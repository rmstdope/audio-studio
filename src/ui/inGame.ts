import type { LineState, LineStatus } from '../core/planner'

/** A recorded line of a character, as its page lists it to be heard. */
export interface RecordedLine {
  /** Unique across parts: the part and the line's key. */
  id: string
  part: string
  /** The part's short title. */
  title: string
  text: string
  cue: string
  status: LineStatus
  /** The clip's file in the part's clips folder. */
  file: string
}

/**
 * A speaker's lines that have a clip, part by part (in the order given) and in dialog order
 * within each; a part not loaded yet (`lines: null`) adds none.
 */
export function recordedLinesOf(
  parts: { id: string; title: string; lines: LineState[] | null }[],
  speaker: string,
): RecordedLine[] {
  return parts.flatMap(({ id, title, lines }) =>
    (lines ?? []).flatMap((l) =>
      l.speaker === speaker && l.file
        ? [
            {
              id: `${id}/${l.key}`,
              part: id,
              title,
              text: l.text,
              cue: l.cue,
              status: l.status,
              file: l.file,
            },
          ]
        : [],
    ),
  )
}

/** The clip to play after `ended` when playing `queue` in turn, or null after the last. */
export function afterInTurn(queue: string[], ended: string): string | null {
  const at = queue.indexOf(ended)
  return at >= 0 && at + 1 < queue.length ? queue[at + 1]! : null
}
