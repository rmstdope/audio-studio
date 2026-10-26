import { basename } from 'node:path'
import { ProjectSchema, problemsFrom, type Problem } from '../core/project'
import type { Stage } from '../core/models'
import { isPriced } from '../core/prices'
import { REPLACEMENT_MODEL, RETIRED_MODEL, retiringTakes, type Take } from '../core/retirement'
import { writeFailure } from './files'
import {
  openProject,
  projectJson,
  projectWrites,
  saveProject,
  type OpenedProject,
} from './projectFile'
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
    return save(projectFile, opened, PATH)
  })
}

/**
 * Saves the model one stage uses (`narration.models.<stage>` in the project file). `was` is the
 * model the page showed: if the file names another, someone changed it meanwhile and nothing is
 * written. Only a model the studio has a price for is accepted, and not `s1`, which is going
 * away. A file that named no models gets all three written, as they were. The rest of the file
 * stays as it was, in its own indentation and line endings.
 */
export function setStageModel(
  projectFile: string,
  stage: Stage,
  model: string,
  was: string,
): Promise<ModelsChange> {
  return projectWrites.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const file = basename(projectFile)
    const path = `${PATH}.${stage}`
    const refuse = (message: string): ModelsChange => ({
      ok: false,
      problems: [{ file, path, message }],
    })
    if (opened.project.narration.models[stage] !== was) {
      return refuse('the model in the file changed since the page was read; reload the studio')
    }
    if (!isPriced(model) || model === RETIRED_MODEL) {
      return refuse(`${model} is not a model the studio can switch to`)
    }
    const narration = (opened.raw as { narration: { models?: Record<string, unknown> } }).narration
    narration.models = { ...opened.project.narration.models, ...narration.models, [stage]: model }
    const parsed = ProjectSchema.safeParse(opened.raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(file, parsed.error) }
    return save(projectFile, opened, path)
  })
}

/** Writes the changed project file, or says why the disk refused it (`path` is what changed). */
async function save(
  projectFile: string,
  opened: OpenedProject,
  path: string,
): Promise<ModelsChange> {
  try {
    await saveProject(projectFile, opened, (indent) => projectJson(opened.raw, indent))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      problems: [{ file: basename(projectFile), path, message: writeFailure(error) }],
    }
  }
}
