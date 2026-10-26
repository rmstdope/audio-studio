import type { PartSummary } from '../core/summary'
import type { Route } from './route'

/** The workspace whose acts the sidebar lists: the one the page shown belongs to, else none. */
export function openWorkspace(route: Route): 'narration' | 'music' | null {
  if (route.view === 'part' || route.view === 'lines') return 'narration'
  return route.view === 'music' ? 'music' : null
}

/** What an act's sidebar entry shows at the right: its line count, or why it has none. */
export function actCount(part: Pick<PartSummary, 'dialog' | 'lineCount'>): {
  text: string
  warn: boolean
} {
  if (part.dialog === 'ok') return { text: String(part.lineCount), warn: false }
  if (part.dialog === 'gone') return { text: 'dialog gone', warn: true }
  return { text: part.dialog === 'missing' ? 'no script' : 'invalid', warn: false }
}
