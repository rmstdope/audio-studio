import { z } from 'zod'

/**
 * The user's notes on one part's lines ("too fast", "retake after the rewrite"): the studio's own,
 * kept in the tool cache. Saved files are checked against this schema when read back.
 */
export const NotesSchema = z.object({
  version: z.literal(1),
  part: z.string(),
  /** Line key → the note. */
  lines: z.record(z.string(), z.string()),
})

/** The notes on one part's lines. */
export type Notes = z.infer<typeof NotesSchema>

/** No notes on the part yet. */
export function emptyNotes(part: string): Notes {
  return { version: 1, part, lines: {} }
}

/**
 * With `note` on `key`, trimmed, replacing the note before; an empty note removes it. Unchanged,
 * the same object, when nothing changes.
 */
export function withNote(notes: Notes, key: string, note: string): Notes {
  // Own keys only: a line keyed `__proto__` is written, but dropped when the file is read back
  // (as a pronunciation so keyed is, see `core/resources.ts`); a key that odd is not expected.
  const text = note.trim()
  const current = Object.hasOwn(notes.lines, key) ? notes.lines[key] : undefined
  if (text === (current ?? '')) return notes
  if (text) return { ...notes, lines: { ...notes.lines, [key]: text } }
  const { [key]: _gone, ...lines } = notes.lines
  return { ...notes, lines }
}
