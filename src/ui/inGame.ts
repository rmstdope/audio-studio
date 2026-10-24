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

/** How many recorded lines are listed before "All N lines". */
export const SHOWN_LINES = 5

/** A part the list is made from, and whether its lines are in yet. */
export interface ListedPart {
  id: string
  title: string
  state: 'loaded' | 'pending' | 'failed'
}

/**
 * What the list of recorded lines shows: the lines (the first few, or all), how many more there
 * are, whether they can be played in turn (only once every part is in, so none is left out),
 * what is still loading, whether nothing is recorded at all, and the parts that failed to load.
 */
export function inGameState(parts: ListedPart[], lines: RecordedLine[], all: boolean) {
  const pending = parts.filter((p) => p.state === 'pending').length
  const failed = parts.filter((p) => p.state === 'failed').map(({ id, title }) => ({ id, title }))
  const shown = all ? lines : lines.slice(0, SHOWN_LINES)
  return {
    shown,
    more: lines.length - shown.length,
    canPlayAll: lines.length > 0 && pending === 0,
    loading: pending
      ? `Loading ${lines.length ? `${pending} more` : pending} ${pending === 1 ? 'part' : 'parts'}…`
      : null,
    empty: lines.length === 0 && pending === 0 && failed.length === 0,
    failed,
  }
}
