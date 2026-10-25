import type { LineState } from '../core/planner'
import { plural } from './format'

/** A line's clip to play in a playthrough: the line's key and its file in the clips folder. */
export interface TurnClip {
  key: string
  file: string
}

/**
 * The clips of the lines shown, in the order shown (dialog order, filtered as the table is), so a
 * part is heard as the game plays it: every speaker in turn. From `from` onward when given and
 * shown, else from the first. Lines without a clip are left out.
 */
export function clipsInTurn(lines: LineState[], from?: string): TurnClip[] {
  const start =
    from === undefined
      ? 0
      : Math.max(
          0,
          lines.findIndex((l) => l.key === from),
        )
  return lines.slice(start).flatMap((l) => (l.file ? [{ key: l.key, file: l.file }] : []))
}

/**
 * The playthrough button: Stop while a list plays (whatever the table shows by now: the list is
 * fixed when it starts), else Play for the lines shown with a clip, or none when there is nothing
 * to play.
 */
export function playthroughButton(
  inTurn: boolean,
  withClip: number,
  shown: number,
): { stop: boolean; label: string } | null {
  if (inTurn) return { stop: true, label: 'Stop' }
  return withClip > 0 ? { stop: false, label: playthroughLabel(withClip, shown) } : null
}

/** The Play button's label: how many of the lines shown have a clip to play. */
export function playthroughLabel(withClip: number, shown: number): string {
  return withClip === shown
    ? `Play ${plural(withClip, 'line')} in turn`
    : `Play ${withClip} of ${plural(shown, 'line')} in turn`
}
