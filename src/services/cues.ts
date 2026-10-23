import { dirname } from 'node:path'
import { resolveInRoot } from '../core/paths'
import { problemsFrom, type Problem } from '../core/project'
import { CuesSchema } from '../core/resources'
import { readJson, writeAtomic } from './files'
import { inPartTurn } from './partFiles'
import { readPart, type ProjectFailure } from './workspace'

/** What changing a cue did, or why it did nothing. Null for an unknown part or line. */
export type CueChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/**
 * Saves a line's own delivery cue in the part's cues file, trimmed; an empty cue removes it, so the
 * line goes back to its character's style. The file is hand-edited too, so it keeps its order
 * (a new cue goes at the end) and two-space indent; a broken file is reported, never overwritten.
 */
export async function setCue(
  projectFile: string,
  partId: string,
  key: string,
  cue: string,
): Promise<CueChange> {
  const read = await readPart(projectFile, partId)
  if (!read || !read.ok) return read
  if (!read.input.lines.some((line) => line.key === key)) return null
  const root = dirname(projectFile)
  const path = read.paths.cuesPath
  const own = cue.trim()

  return inPartTurn(projectFile, partId, async (): Promise<CueChange> => {
    const json = await readJson(resolveInRoot(root, path))
    if (json.status === 'invalid') {
      return { ok: false, problems: [{ file: path, path: '', message: json.message }] }
    }
    const raw = json.status === 'missing' ? {} : json.value
    const parsed = CuesSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(path, parsed.error) }
    const cues = { ...parsed.data }
    if (own) cues[key] = own
    else delete cues[key]
    await writeAtomic(root, path, `${JSON.stringify(cues, null, 2)}\n`)
    return { ok: true }
  })
}
