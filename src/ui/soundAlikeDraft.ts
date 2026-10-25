import { groupsFrom, rowsFrom } from '../core/soundAlikeEdit'

/** Sound-alike groups being edited: rows as typed, with stable ids, and the groups begun from. */
export interface SoundAlikeDraft {
  /** The groups shown when editing began: what the file must still have for a save to apply. */
  base: string[][]
  rows: { id: number; text: string }[]
  nextId: number
}

/** A draft of `groups`, as shown now: ids by place, so the same groups give the same rows. */
export function startDraft(groups: string[][]): SoundAlikeDraft {
  return {
    base: groups,
    rows: rowsFrom(groups).map((text, id) => ({ id, text })),
    nextId: groups.length,
  }
}

/** The draft's groups, as they would be saved. */
export function groupsOf(draft: SoundAlikeDraft): string[][] {
  return groupsFrom(draft.rows.map((row) => row.text))
}

/** The draft with one row's words changed. */
export function editGroup(draft: SoundAlikeDraft, index: number, text: string): SoundAlikeDraft {
  return { ...draft, rows: draft.rows.map((row, i) => (i === index ? { ...row, text } : row)) }
}

/** The draft with an empty row at the end. */
export function addGroup(draft: SoundAlikeDraft): SoundAlikeDraft {
  return {
    ...draft,
    rows: [...draft.rows, { id: draft.nextId, text: '' }],
    nextId: draft.nextId + 1,
  }
}

/** The draft without one row. */
export function removeGroup(draft: SoundAlikeDraft, index: number): SoundAlikeDraft {
  return { ...draft, rows: draft.rows.filter((_, i) => i !== index) }
}
