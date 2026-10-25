import { basename } from 'node:path'
import { ProjectSchema, problemsFrom, type Problem } from '../core/project'
import { cleanGroups, groupsProblem, sameGroups } from '../core/soundAlikeEdit'
import { openProject, projectWrites, saveProject } from './projectFile'
import type { ProjectFailure } from './workspace'

/** A saved list of sound-alike groups, or why it was not saved. */
export type SoundAlikeChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure

const PATH = 'narration.quality.soundAlike'

/**
 * Saves the project's own words that sound the same (`narration.quality.soundAlike` in the
 * project file), words trimmed and empty ones dropped. The file is read once, and the rest of it
 * kept as it was: its indentation, line endings and last newline (only a hand-compacted object
 * is written out, and numbers and escapes as JSON writes them). `was` is the list the editing
 * began from: if the file's differs, someone changed it meanwhile, and nothing is written. An
 * empty list leaves the key out. Takes already recorded keep their heard share; the groups count
 * from the next take on.
 */
export function setSoundAlike(
  projectFile: string,
  groups: string[][],
  was: string[][],
): Promise<SoundAlikeChange> {
  const clean = cleanGroups(groups)
  return projectWrites.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { raw, project } = opened
    const file = basename(projectFile)

    const problem = (message: string): SoundAlikeChange => ({
      ok: false,
      problems: [{ file, path: PATH, message }],
    })
    if (!sameGroups(project.narration.quality.soundAlike, was)) {
      return problem(
        'the words that sound the same in the file changed since editing began; discard your changes to see them',
      )
    }
    const wrong = groupsProblem(clean)
    if (wrong) return problem(wrong)

    const narration = (raw as { narration: Record<string, unknown> }).narration
    const had = isObject(narration.quality) ? narration.quality : {}
    const quality = { ...had }
    if (clean.length) quality.soundAlike = clean
    else delete quality.soundAlike
    // A quality left empty goes only when the groups were all it held, not when it was empty.
    const emptied = !Object.keys(quality).length && 'soundAlike' in had
    if (emptied || !('quality' in narration || clean.length)) delete narration.quality
    else narration.quality = quality
    const parsed = ProjectSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(file, parsed.error) }

    await saveProject(projectFile, opened, (indent) => layout(raw, indent, clean))
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
  const oneLine = (group: string[]) => `[${group.map((w) => JSON.stringify(w)).join(', ')}]`
  // A function, not a string, as the replacement: a "$" in a word is not a pattern.
  return groups.reduce(
    (text, group, i) => text.replace(JSON.stringify(mark(i)), () => oneLine(group)),
    JSON.stringify(raw, null, indent),
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
