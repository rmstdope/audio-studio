import { z } from 'zod'
import type { Problem } from './project'

/** One paid recording, as the record keeps it. */
const RecordingSchema = z.object({
  id: z.string(),
  /** When the recording started (ISO 8601). */
  at: z.string(),
  part: z.string(),
  language: z.string(),
  model: z.string(),
  stage: z.enum(['draft', 'final']),
  /** Lines recorded: finished, not skipped, not failed. */
  lines: z.number().int().min(0),
  /** Lines the recording set out to do. */
  planned: z.number().int().min(0),
  /** Dollars charged to the recording's budget, at Fish's prices as each line was sent. */
  cost: z.number().min(0),
  /** ElevenLabs credits charged for its lines with ElevenLabs voices (version 2 only). */
  credits: z.number().min(0).optional(),
  /** The ElevenLabs model those lines were recorded with (version 2 only). */
  elevenModel: z.string().optional(),
  outcome: z.enum(['done', 'stopped', 'error']),
})

/** One paid music take: made, or stopped while it was made (which may still be billed). */
const MusicSpendSchema = z.object({
  id: z.string(),
  /** When the take ended (ISO 8601). */
  at: z.string(),
  /** The list the track is in: an act's id, or `stingers`. */
  part: z.string(),
  track: z.string(),
  /** The track's title when the take was made. */
  title: z.string(),
  /** The music model's id. */
  model: z.string(),
  /** The seconds the take was made long, which are billed. */
  seconds: z.number().min(0),
  /** Its price in dollars, at the model's price a minute. */
  cost: z.number().min(0),
  outcome: z.enum(['done', 'stopped']),
})

/**
 * What the studio remembers of what it spent, kept in `.audio-studio/spending.json`: one entry per
 * recording that cost money, added when the recording ends, and in version 2 the ElevenLabs
 * credits of a recording and a row per paid music take. A record holding nothing of version 2's
 * is written as version 1, which an older studio reads. Saved files are checked against this
 * schema when read back.
 */
export const SpendingSchema = z.discriminatedUnion('version', [
  z.object({ version: z.literal(1), recordings: z.array(RecordingSchema) }),
  z.object({
    version: z.literal(2),
    recordings: z.array(RecordingSchema),
    music: z.array(MusicSpendSchema),
  }),
])

/** The saved record of what was spent. */
export type Spending = z.infer<typeof SpendingSchema>

/** One finished paid recording. */
export type Recording = z.infer<typeof RecordingSchema>

/** One paid music take. */
export type MusicSpend = z.infer<typeof MusicSpendSchema>

/** How a recording ended: all done, stopped by the user, or with a line that failed. */
export type Outcome = Recording['outcome']

/** A paid recording going on now: not saved yet, read from the running job. */
export type Running = Pick<
  Recording,
  | 'id'
  | 'at'
  | 'part'
  | 'language'
  | 'model'
  | 'lines'
  | 'planned'
  | 'cost'
  | 'credits'
  | 'elevenModel'
>

/** Whether a record needs version 2 to be written: ElevenLabs credits, or a music take. */
export function needsVersion2(recordings: Recording[], music: MusicSpend[]): boolean {
  return music.length > 0 || recordings.some((r) => r.credits !== undefined)
}

/** How a job ended: cancelled is stopped, any failed line is an error (even when cancelled). */
export function outcomeOf({
  status,
  failed,
}: {
  status: 'done' | 'cancelled'
  failed: number
}): Outcome {
  if (failed > 0) return 'error'
  return status === 'cancelled' ? 'stopped' : 'done'
}

/** A row of the page's list: a recording, or a music take. */
export interface SpendingRow {
  id: string
  kind: 'narration' | 'music'
  at: string
  part: string
  /** True when the part is no longer in the project. */
  removed: boolean
  language: string
  model: string
  /** A recording's ElevenLabs model, when it had lines with ElevenLabs voices. */
  elevenModel?: string
  lines: number
  planned: number
  /** Dollars. */
  cost: number
  /** ElevenLabs credits. */
  credits: number
  /** A music take's track title, and the seconds it was made long. */
  track?: string
  seconds?: number
  state: 'running' | Outcome
}

/** What the page shows: totals, each unit apart, and the list. */
export interface SpendingSummary {
  /** Dollars, recordings and music takes. */
  total: number
  /** ElevenLabs credits. */
  credits: number
  /** Recordings, running ones included. */
  count: number
  /** Music takes. */
  takes: number
  /** One total per act: the project's own, in order, then those no longer in the project. */
  acts: { part: string; title: string; total: number; credits: number; removed: boolean }[]
  rows: SpendingRow[]
}

/**
 * The recordings, the running ones and the music takes as the page shows them: running first,
 * then the rest newest first; the totals count them all, dollars and credits apart.
 */
export function summariseSpending(
  recordings: Recording[],
  running: Running[],
  parts: { id: string; title: string }[],
  music: MusicSpend[] = [],
): SpendingSummary {
  const known = new Set(parts.map((p) => p.id))
  const rowOf = (r: Running | Recording, state: SpendingRow['state']): SpendingRow => ({
    id: r.id,
    kind: 'narration',
    at: r.at,
    part: r.part,
    removed: !known.has(r.part),
    language: r.language,
    model: r.model,
    ...(r.elevenModel !== undefined && { elevenModel: r.elevenModel }),
    lines: r.lines,
    planned: r.planned,
    cost: r.cost,
    credits: r.credits ?? 0,
    state,
  })
  const takeRow = (t: MusicSpend): SpendingRow => ({
    id: t.id,
    kind: 'music',
    at: t.at,
    part: t.part,
    removed: !known.has(t.part),
    language: '',
    model: t.model,
    lines: 0,
    planned: 0,
    cost: t.cost,
    credits: 0,
    track: t.title,
    seconds: t.seconds,
    state: t.outcome,
  })
  const newestFirst = (a: SpendingRow, b: SpendingRow) =>
    a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1
  const live = running.map((r) => rowOf(r, 'running')).sort(newestFirst)
  const done = [...recordings.map((r) => rowOf(r, r.outcome)), ...music.map(takeRow)].sort(
    newestFirst,
  )
  const rows = [...live, ...done]

  const totals = new Map<string, { total: number; credits: number }>()
  for (const row of rows) {
    const sum = totals.get(row.part) ?? { total: 0, credits: 0 }
    totals.set(row.part, { total: sum.total + row.cost, credits: sum.credits + row.credits })
  }
  const gone = [...totals.keys()].filter((id) => !known.has(id)).sort()
  const of = (id: string) => totals.get(id) ?? { total: 0, credits: 0 }
  return {
    total: rows.reduce((sum, row) => sum + row.cost, 0),
    credits: rows.reduce((sum, row) => sum + row.credits, 0),
    count: rows.filter((row) => row.kind === 'narration').length,
    takes: rows.filter((row) => row.kind === 'music').length,
    acts: [
      ...parts.map((p) => ({ part: p.id, title: p.title, ...of(p.id), removed: false })),
      ...gone.map((id) => ({ part: id, title: id, ...of(id), removed: true })),
    ],
    rows,
  }
}

/** What the Spending page is told: the summary, or why the record could not be read. */
export type SpendingAnswer =
  ({ ok: true; languages: number } & SpendingSummary) | { ok: false; problems: Problem[] }
