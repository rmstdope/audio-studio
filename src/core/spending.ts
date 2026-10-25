import { z } from 'zod'

/**
 * What the studio remembers of its paid recordings, kept in `.audio-studio/spending.json`: one
 * entry per recording that cost money, added when the recording ends. Saved files are checked
 * against this schema when read back.
 */
export const SpendingSchema = z.object({
  version: z.literal(1),
  recordings: z.array(
    z.object({
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
      outcome: z.enum(['done', 'stopped', 'error']),
    }),
  ),
})

/** The saved record of paid recordings. */
export type Spending = z.infer<typeof SpendingSchema>

/** One finished paid recording. */
export type Recording = Spending['recordings'][number]

/** How a recording ended: all done, stopped by the user, or with a line that failed. */
export type Outcome = Recording['outcome']

/** A paid recording going on now: not saved yet, read from the running job. */
export type Running = Pick<
  Recording,
  'id' | 'at' | 'part' | 'language' | 'model' | 'lines' | 'planned' | 'cost'
>

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

/** A row of the page's list. */
export interface SpendingRow {
  id: string
  at: string
  part: string
  /** True when the part is no longer in the project. */
  removed: boolean
  language: string
  model: string
  lines: number
  planned: number
  cost: number
  state: 'running' | Outcome
}

/** What the page shows: totals and the list. */
export interface SpendingSummary {
  total: number
  count: number
  /** One total per act: the project's own, in order, then those no longer in the project. */
  acts: { part: string; title: string; total: number; removed: boolean }[]
  rows: SpendingRow[]
}

/**
 * The recordings and the running ones as the page shows them: running first, then the rest
 * newest first; the totals count both.
 */
export function summariseSpending(
  recordings: Recording[],
  running: Running[],
  parts: { id: string; title: string }[],
): SpendingSummary {
  const known = new Set(parts.map((p) => p.id))
  const rowOf = (r: Running | Recording, state: SpendingRow['state']): SpendingRow => ({
    id: r.id,
    at: r.at,
    part: r.part,
    removed: !known.has(r.part),
    language: r.language,
    model: r.model,
    lines: r.lines,
    planned: r.planned,
    cost: r.cost,
    state,
  })
  const newestFirst = (a: SpendingRow, b: SpendingRow) =>
    a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1
  const live = running.map((r) => rowOf(r, 'running')).sort(newestFirst)
  const done = recordings.map((r) => rowOf(r, r.outcome)).sort(newestFirst)
  const rows = [...live, ...done]

  const totals = new Map<string, number>()
  for (const row of rows) totals.set(row.part, (totals.get(row.part) ?? 0) + row.cost)
  const gone = [...totals.keys()].filter((id) => !known.has(id)).sort()
  return {
    total: rows.reduce((sum, row) => sum + row.cost, 0),
    count: rows.length,
    acts: [
      ...parts.map((p) => ({
        part: p.id,
        title: p.title,
        total: totals.get(p.id) ?? 0,
        removed: false,
      })),
      ...gone.map((id) => ({ part: id, title: id, total: totals.get(id) ?? 0, removed: true })),
    ],
    rows,
  }
}
