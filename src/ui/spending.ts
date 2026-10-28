import type { SpendingRow, SpendingSummary } from '../core/spending'
import { MUSIC_MODELS } from '../core/musicModels'
import { credits } from './agreed'
import { clock, dollars, plural } from './format'

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
  if (row.kind === 'music') {
    const count = `Music take · ${row.track ?? ''}`
    if (row.state === 'stopped') return { count, note: 'stopped while being made; may be billed' }
    return { count, note: `${clock(row.seconds ?? 0)} made` }
  }
  if (row.state === 'done') return { count: String(row.lines), note: null }
  const count = `${row.lines} of ${row.planned}`
  if (row.state === 'running') return { count, note: null }
  return { count, note: row.state === 'stopped' ? 'stopped' : 'ended on an error' }
}

/** Dollars and credits together: each there is any of (`$0.78 · 1,200 credits`), else `$0.00`. */
export function amountText(usd: number, credit: number): string {
  if (!credit) return dollars(usd)
  return usd ? `${dollars(usd)} · ${credits(credit)}` : credits(credit)
}

/** The Cost cell: the dollars and the ElevenLabs credits, and `so far` while the recording runs. */
export function costText(row: SpendingRow): string {
  const amount = amountText(row.cost, row.credits)
  return row.state === 'running' ? `${amount} so far` : amount
}

/** The Model cell: a recording's Fish model and its ElevenLabs one, or a music model's name. */
export function modelText(row: SpendingRow): string {
  if (row.kind === 'music') return MUSIC_MODELS.find((m) => m.id === row.model)?.name ?? row.model
  if (!row.elevenModel) return row.model
  // Only the models that spent: a recording on ElevenLabs alone names no Fish model.
  return row.cost > 0 ? `${row.model} · ${row.elevenModel}` : row.elevenModel
}

/** The act's full title; an act no longer in the project is its id (the page adds the note). */
export function actText(row: SpendingRow, acts: SpendingSummary['acts']): string {
  return acts.find((a) => a.part === row.part)?.title ?? row.part
}

/**
 * The first total's label: `All acts · 9 recordings · 2 music takes · 5 takes, tries and designs`, the
 * part label in the project's words, each count there is any of.
 */
export function totalsLabel(count: number, partLabel: string, takes = 0, tries = 0): string {
  const counts = [
    ...(count || (!takes && !tries) ? [plural(count, 'recording')] : []),
    ...(takes ? [plural(takes, 'music take')] : []),
    ...(tries
      ? [
          tries === 1
            ? '1 take, try or design'
            : `${tries.toLocaleString('en-US')} takes, tries and designs`,
        ]
      : []),
  ]
  return `All ${partLabel.toLowerCase()}s · ${counts.join(' · ')}`
}

/**
 * A language written out in English (`sv` → `Swedish`), as the page's Language column wants; `languageName` gives the endonym
 * (`Svenska`) and is not used here. The code itself if it has no name.
 */
export function languageText(code: string): string {
  return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' }).of(code) ?? code
}
