import { dirname } from 'node:path'
import { resolveInRoot } from '../core/paths'
import { problemsFrom, type Problem } from '../core/project'
import { CuesSchema } from '../core/resources'
import { readJson, writeAtomic } from './files'
import { inPartTurn } from './partFiles'
import { readPart, type ProjectFailure } from './workspace'

/** What changing a cue did, or why it did nothing. Null for an unknown part or line. */
export type CueChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** Keys JavaScript would move to the front of an object, changing the file's order. */
const INTEGER_LIKE = /^(0|[1-9]\d*)$/

/**
 * Saves a line's own delivery cue in the part's cues file, trimmed; an empty cue removes it, so the
 * line goes back to its character's style. The file is hand-edited too: its order is kept (a new
 * cue goes at the end) and it is written with two-space indent, one cue per line; nothing is
 * written when the cue does not change. A broken file is reported, never overwritten, and so is a
 * number-like key (`"10"`), which JavaScript would move to the front.
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
    // The entries as parsed from the file (own keys only), so `__proto__` is a key like any other.
    const entries = Object.entries(raw as Record<string, string>)
    const current = entries.find(([k]) => k === key)?.[1] ?? ''
    if (current === own) return { ok: true }

    const changed: [string, string][] = own
      ? entries.some(([k]) => k === key)
        ? entries.map(([k, v]) => [k, k === key ? own : v])
        : [...entries, [key, own]]
      : entries.filter(([k]) => k !== key)
    const moved = changed.map(([k]) => k).filter((k) => INTEGER_LIKE.test(k))
    if (moved.length && changed.length > 1) {
      const message =
        `the cue of ${moved.map((k) => `"${k}"`).join(', ')} would move to the top if the studio ` +
        'wrote this file; edit the file by hand.'
      return { ok: false, problems: [{ file: path, path: moved[0]!, message }] }
    }
    await writeAtomic(root, path, formatCues(changed))
    return { ok: true }
  })
}

/** The cues file's text: two-space indent, one cue per line, in the order given. */
function formatCues(entries: [string, string][]): string {
  if (!entries.length) return '{}\n'
  const lines = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  return `{\n${lines.join(',\n')}\n}\n`
}
