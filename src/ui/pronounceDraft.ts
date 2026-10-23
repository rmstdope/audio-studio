import type { Pronunciation } from '../core/pronounce'

/** A table being edited: its rows with stable ids, and the table it was started from. */
export interface PronounceDraft {
  /** The table shown when editing began: what the file must still have for a save to apply. */
  base: Pronunciation[]
  rows: { id: number; entry: Pronunciation }[]
  nextId: number
}

/** A draft of `table`, as shown now. */
export function startDraft(table: Pronunciation[]): PronounceDraft {
  return {
    base: table,
    rows: table.map((entry, id) => ({ id, entry })),
    nextId: table.length,
  }
}

/** The draft's table, in its order. */
export function tableOf(draft: PronounceDraft): Pronunciation[] {
  return draft.rows.map((row) => row.entry)
}

/** The draft with one side of one row changed. */
export function editRow(
  draft: PronounceDraft,
  index: number,
  side: 0 | 1,
  value: string,
): PronounceDraft {
  const rows = draft.rows.map((row, i) => {
    if (i !== index) return row
    const [written, said] = row.entry
    return { ...row, entry: (side ? [written, value] : [value, said]) as Pronunciation }
  })
  return { ...draft, rows }
}

/** The draft with a row moved one place up (-1) or down (1). */
export function moveRow(draft: PronounceDraft, index: number, by: -1 | 1): PronounceDraft {
  const rows = [...draft.rows]
  const [taken] = rows.splice(index, 1)
  rows.splice(index + by, 0, taken!)
  return { ...draft, rows }
}

/** The draft with an empty row at the end. */
export function addRow(draft: PronounceDraft): PronounceDraft {
  return {
    ...draft,
    rows: [...draft.rows, { id: draft.nextId, entry: ['', ''] }],
    nextId: draft.nextId + 1,
  }
}

/** The draft without one row. */
export function removeRow(draft: PronounceDraft, index: number): PronounceDraft {
  return { ...draft, rows: draft.rows.filter((_, i) => i !== index) }
}
