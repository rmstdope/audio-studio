import { basename } from 'node:path'
import { ProjectSchema, problemsFrom, type Problem } from '../core/project'
import { REPLACEMENT_MODEL, retiringTakes, type Take } from '../core/retirement'
import { openProject, projectWrites, saveProject } from './projectFile'
import type { ProjectFailure } from './workspace'

/** A switch of the retired model, or why nothing was written. */
export type ModelsChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure

const PATH = 'narration.models'

/**
 * Moves the takes in `takes` from `s1` to `s2.1-pro` in the project file (`narration.models`).
 * `takes` is what the page showed: if the file's models on s1 are any others, someone changed it
 * meanwhile and nothing is written. Only those keys change; the audition model, a model that is
 * not s1 and the rest of the file stay as they were, in its own indentation and line endings.
 * Recorded lines are not touched.
 */
export function switchRetiredModels(projectFile: string, takes: Take[]): Promise<ModelsChange> {
  return projectWrites.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const file = basename(projectFile)
    const now = retiringTakes(opened.project.narration.models)
    if (now.length === 0 || now.join() !== [...takes].sort().join()) {
      return {
        ok: false,
        problems: [
          {
            file,
            path: PATH,
            message: 'the models in the file changed since the page was read; reload the studio',
          },
        ],
      }
    }
    const models = (opened.raw as { narration: { models: Record<string, unknown> } }).narration
      .models
    for (const take of now) models[take] = REPLACEMENT_MODEL
    const parsed = ProjectSchema.safeParse(opened.raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(file, parsed.error) }
    await saveProject(projectFile, opened, (indent) => JSON.stringify(opened.raw, null, indent))
    return { ok: true }
  })
}
