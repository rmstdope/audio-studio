import type { SpendingRow, SpendingSummary } from '../core/spending'
import { dollars, plural } from './format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** When a recording started: day, month and time (`25 Oct, 14:02`), or `Now` while it runs. */
export function whenText(at: string, running = false): string {
  if (running) return 'Now'
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The Lines cell: the lines recorded, or `N of M` while running or when it ended early, with a
 * note saying how it ended.
 */
export function linesText(row: SpendingRow): { count: string; note: string | null } {
  if (row.state === 'done') return { count: String(row.lines), note: null }
  const count = `${row.lines} of ${row.planned}`
  if (row.state === 'running') return { count, note: null }
  return { count, note: row.state === 'stopped' ? 'stopped' : 'ended on an error' }
}

/** The Cost cell: the dollars, and `so far` while the recording runs. */
export function costText(row: SpendingRow): string {
  return row.state === 'running' ? `${dollars(row.cost)} so far` : dollars(row.cost)
}

/** The act's full title; an act no longer in the project is its id (the page adds the note). */
export function actText(row: SpendingRow, acts: SpendingSummary['acts']): string {
  return acts.find((a) => a.part === row.part)?.title ?? row.part
}

/** The first total's label: `All acts · 9 recordings`, the part label in the project's words. */
export function totalsLabel(count: number, partLabel: string): string {
  return `All ${partLabel.toLowerCase()}s · ${plural(count, 'recording')}`
}

/**
 * A language written out in English (`sv` → `Swedish`), as the page's Language column wants; `languageName` gives the endonym
 * (`Svenska`) and is not used here. The code itself if it has no name.
 */
export function languageText(code: string): string {
  return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' }).of(code) ?? code
}
