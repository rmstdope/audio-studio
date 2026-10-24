import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { ProjectSchema, problemsFrom, type Problem } from '../core/project'
import { cleanGroups, groupsProblem, sameGroups } from '../core/soundAlikeEdit'
import { writeAtomic } from './files'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** A saved list of sound-alike groups, or why it was not saved. */
export type SoundAlikeChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure

const writes = createSerial()

const PATH = 'narration.quality.soundAlike'

/**
 * Saves the project's own words that sound the same (`narration.quality.soundAlike` in the
 * project file), words trimmed and empty ones dropped; the rest of the file is kept as written,
 * in its own indentation. `was` is the list the editing began from: if the file's differs,
 * someone changed it meanwhile, and nothing is written. An empty list leaves the key out. Takes
 * already recorded keep their heard share; the groups count from the next take on.
 */
export function setSoundAlike(
  projectFile: string,
  groups: string[][],
  was: string[][],
): Promise<SoundAlikeChange> {
  const clean = cleanGroups(groups)
  return writes.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const file = basename(projectFile)
    const problem = (message: string): SoundAlikeChange => ({
      ok: false,
      problems: [{ file, path: PATH, message }],
    })
    if (!sameGroups(opened.project.narration.quality.soundAlike, was)) {
      return problem(
        'the words that sound the same in the file changed since editing began; discard your changes to see them',
      )
    }
    const wrong = groupsProblem(clean)
    if (wrong) return problem(wrong)

    const text = await readFile(projectFile, 'utf8')
    const raw = JSON.parse(text) as { narration: Record<string, unknown> }
    const quality = { ...(isObject(raw.narration.quality) ? raw.narration.quality : {}) }
    if (clean.length) quality.soundAlike = clean
    else delete quality.soundAlike
    if (Object.keys(quality).length) raw.narration.quality = quality
    else delete raw.narration.quality
    const parsed = ProjectSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(file, parsed.error) }
    const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? '  '
    await writeAtomic(dirname(projectFile), file, `${layout(raw, indent, clean)}\n`)
    return { ok: true }
  })
}

/**
 * The project file's JSON in `indent`, each sound-alike group on one line (`["inn", "in"]`), as
 * the groups would be written by hand.
 */
function layout(raw: unknown, indent: string, groups: string[][]): string {
  const mark = (i: number) => `\u0000group ${i}`
  const quality = (raw as { narration: { quality?: { soundAlike?: unknown } } }).narration.quality
  if (quality?.soundAlike) quality.soundAlike = groups.map((_, i) => mark(i))
  return groups.reduce(
    (text, group, i) =>
      text.replace(JSON.stringify(mark(i)), `[${group.map((w) => JSON.stringify(w)).join(', ')}]`),
    JSON.stringify(raw, null, indent),
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
