import { basename } from 'node:path'
import { ProjectSchema, problemsFrom, type Problem } from '../core/project'
import { openProject, projectJson, projectWrites, saveProject } from './projectFile'
import type { ProjectFailure } from './workspace'

/** A saved take fade, or why it was not saved. */
export type TakeFadeChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure

/**
 * Saves how long takes fade in and out when played in the studio (`takeFade` in the project file,
 * in seconds, 0 for none). The file is read once and the rest of it kept as it was, in its own
 * indentation and line endings.
 */
export function setTakeFade(projectFile: string, seconds: number): Promise<TakeFadeChange> {
  return projectWrites.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { raw } = opened
    ;(raw as Record<string, unknown>).takeFade = seconds
    const parsed = ProjectSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, problems: problemsFrom(basename(projectFile), parsed.error) }
    }
    return saveProject(projectFile, opened, 'takeFade', (indent) => projectJson(raw, indent))
  })
}
