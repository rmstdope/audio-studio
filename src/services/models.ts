import { basename } from 'node:path'
import { ProjectSchema, problemsFrom, type Problem } from '../core/project'
import type { Stage } from '../core/models'
import { MUSIC_MODEL_IDS, DEFAULT_MUSIC_MODEL } from '../core/musicModels'
import { isPriced } from '../core/prices'
import { REPLACEMENT_MODEL, RETIRED_MODEL, retiringTakes, type Take } from '../core/retirement'
import { openProject, projectJson, projectWrites, saveProject } from './projectFile'
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
    return saveProject(projectFile, opened, PATH, (indent) => projectJson(opened.raw, indent))
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
    return saveProject(projectFile, opened, path, (indent) => projectJson(opened.raw, indent))
  })
}

/**
 * Saves the music model new takes are made with (`music.model` in the project file). `was` is the
 * model the page showed (Balanced when the file names none): if the file names another, someone
 * changed it meanwhile and nothing is written. A project with no music section has no model to
 * save. The rest of the file stays as it was, in its own indentation and line endings.
 */
export function setMusicModel(
  projectFile: string,
  model: string,
  was: string,
): Promise<ModelsChange> {
  return projectWrites.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const file = basename(projectFile)
    const refuse = (path: string, message: string): ModelsChange => ({
      ok: false,
      problems: [{ file, path, message }],
    })
    if (!opened.project.music) return refuse('music', 'the project has no music section')
    if (!(MUSIC_MODEL_IDS as readonly string[]).includes(model)) {
      return refuse('music.model', `${model} is not a music model the studio knows`)
    }
    if ((opened.project.music.model ?? DEFAULT_MUSIC_MODEL) !== was) {
      return refuse(
        'music.model',
        'the model in the file changed since the page was read; reload the studio',
      )
    }
    const music = (opened.raw as { music: Record<string, unknown> }).music
    music.model = model
    const parsed = ProjectSchema.safeParse(opened.raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(file, parsed.error) }
    return saveProject(projectFile, opened, 'music.model', (indent) =>
      projectJson(opened.raw, indent),
    )
  })
}
