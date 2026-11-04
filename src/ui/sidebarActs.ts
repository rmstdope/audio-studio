import type { PartSummary } from '../core/summary'
import type { PartProgress } from '../services/workspace'
import type { Route } from './route'

/** The workspace whose acts the sidebar lists: the one the page shown belongs to, else none. */
export function openWorkspace(route: Route): 'narration' | 'music' | 'images' | 'scenes' | null {
  if (route.view === 'part' || route.view === 'lines') return 'narration'
  if (route.view === 'music') return 'music'
  if (route.view === 'scenes') return 'scenes'
  return route.view === 'images' ? 'images' : null
}

/**
 * The colour of a done count: all done (green), at least three quarters (yellow), fewer (red);
 * none for an empty list.
 */
export type DoneTone = 'all' | 'most' | 'few' | null

/** The colour of `done` out of `total`. */
export function doneTone(done: number, total: number): DoneTone {
  if (total === 0) return null
  if (done === total) return 'all'
  return done / total < 0.75 ? 'few' : 'most'
}

/**
 * What an act's sidebar entry shows at the right: its lines that are ok out of all of them
 * (`progress`), with their colour, its line count until that is known, or why it has none.
 */
export function actCount(
  part: Pick<PartSummary, 'dialog' | 'lineCount'>,
  progress?: PartProgress,
): {
  text: string
  warn: boolean
  tone: DoneTone
} {
  if (part.dialog === 'ok') {
    return progress
      ? { ...doneText(progress.ok, progress.lines), warn: false }
      : { text: String(part.lineCount), warn: false, tone: null }
  }
  if (part.dialog === 'gone') return { text: 'dialog gone', warn: true, tone: null }
  return { text: part.dialog === 'missing' ? 'no script' : 'invalid', warn: false, tone: null }
}

/** How many are done out of all, as the sidebar shows it ("2/3"), and its colour. */
export function doneCount({ done, total }: { done: number; total: number }): {
  text: string
  tone: DoneTone
} {
  return doneText(done, total)
}

function doneText(done: number, total: number): { text: string; tone: DoneTone } {
  return { text: `${done}/${total}`, tone: doneTone(done, total) }
}
