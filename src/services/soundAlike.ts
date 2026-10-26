import { basename } from 'node:path'
import {
  ProjectSchema,
  declaredLanguage,
  problemsFrom,
  soundAlikeOf,
  type Problem,
} from '../core/project'
import { cleanGroups, groupsProblem, sameGroups } from '../core/soundAlikeEdit'
import { openProject, projectJson, projectWrites, saveProject } from './projectFile'
import type { ProjectFailure } from './workspace'

/** A saved list of sound-alike groups, or why it was not saved. */
export type SoundAlikeChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure

/**
 * Saves the project's own words that sound the same (`narration.quality.soundAlike` in the
 * project file), words trimmed and empty ones dropped. The file is read once, and the rest of it
 * kept as it was: its indentation, line endings and last newline (only a hand-compacted object
 * is written out, and numbers and escapes as JSON writes them). `was` is the list the editing
 * began from: if the file's differs, someone changed it meanwhile, and nothing is written. An
 * empty list leaves the key out. The source language's groups are `quality.soundAlike`, another
 * language's `quality.soundAlikeByLanguage.<code>`. Takes already recorded keep their heard share; the groups count
 * from the next take on.
 */
export function setSoundAlike(
  projectFile: string,
  groups: string[][],
  was: string[][],
  language?: string,
): Promise<SoundAlikeChange> {
  const clean = cleanGroups(groups)
  return projectWrites.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { raw, project } = opened
    const file = basename(projectFile)
    const which = declaredLanguage(project.narration, language)
    const own = which !== project.narration.languages[0]
    const PATH = own
      ? `narration.quality.soundAlikeByLanguage.${which}`
      : 'narration.quality.soundAlike'

    const problem = (message: string): SoundAlikeChange => ({
      ok: false,
      problems: [{ file, path: PATH, message }],
    })
    if (!sameGroups(soundAlikeOf(project.narration, which), was)) {
      return problem(
        'the words that sound the same in the file changed since editing began; discard your changes to see them',
      )
    }
    const wrong = groupsProblem(clean)
    if (wrong) return problem(wrong)

    const narration = (raw as { narration: Record<string, unknown> }).narration
    const had = isObject(narration.quality) ? narration.quality : {}
    const quality = { ...had }
    if (!own) {
      if (clean.length) quality.soundAlike = clean
      else delete quality.soundAlike
    } else {
      const byLanguage = { ...(isObject(had.soundAlikeByLanguage) ? had.soundAlikeByLanguage : {}) }
      if (clean.length) byLanguage[which] = clean
      else delete byLanguage[which]
      if (Object.keys(byLanguage).length) quality.soundAlikeByLanguage = byLanguage
      else delete quality.soundAlikeByLanguage
    }
    // A quality left empty goes only when the groups were all it held, not when it was empty.
    const emptied =
      !Object.keys(quality).length && ('soundAlike' in had || 'soundAlikeByLanguage' in had)
    if (emptied || !('quality' in narration || clean.length)) delete narration.quality
    else narration.quality = quality
    const parsed = ProjectSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(file, parsed.error) }

    return saveProject(projectFile, opened, PATH, (indent) => projectJson(raw, indent))
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
