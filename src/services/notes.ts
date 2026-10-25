import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withNote } from '../core/notes'
import type { Problem } from '../core/project'
import { resolveInRoot } from '../core/paths'
import { characterFile, writeAtomic } from './files'
import { inPartTurn } from './partFiles'
import { NOTES_DIR, readNotes, readPart, type ProjectFailure } from './workspace'

/** What saving a note did, or why not (a notes file that cannot be read); null for an unknown part or line. */
export type NoteChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/**
 * Saves the user's note on a line in the part's notes file in the tool cache (an empty note
 * removes it; none left removes the file). The studio's own, never the game's: it is not
 * committed, and goes with the cache.
 */
export async function setNote(
  projectFile: string,
  partId: string,
  key: string,
  note: string,
): Promise<NoteChange> {
  return inPartTurn(projectFile, partId, async () => {
    const part = await readPart(projectFile, partId)
    if (!part || !part.ok) return part
    if (!part.input.lines.some((l) => l.key === key)) return null
    const root = dirname(projectFile)
    const { notes: before, problem } = await readNotes(root, partId)
    // Never written over: a broken file may hold notes the user wrote.
    if (problem) return { ok: false, problems: [problem] }
    const next = withNote(before, key, note)
    if (next !== before) {
      const file = characterFile(NOTES_DIR, partId)
      if (Object.keys(next.lines).length) {
        await writeAtomic(root, file, `${JSON.stringify(next, null, 1)}\n`)
      } else {
        await rm(resolveInRoot(root, file), { force: true })
      }
    }
    return { ok: true }
  })
}
