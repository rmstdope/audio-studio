import { basename, dirname } from 'node:path'
import type { Dialog, Recorded, StageModels } from '../core/models'
import { DEFAULT_MUSIC_MODEL, MUSIC_MODELS, type MusicModelId } from '../core/musicModels'
import { planPart } from '../core/planner'
import { spokenPieces } from '../core/spoken'
import { readMusic } from './musicLists'
import { openProject, readPart, type ProjectFailure } from './workspace'

/** What the Models panel needs: the models, the whole dialog, and what recorded clips were made with. */
export type ModelsView =
  | {
      ok: true
      file: string
      models: StageModels
      dialog: Dialog
      recorded: Recorded
      music: MusicModels | null
    }
  | ProjectFailure

/** The project's music model, and which models this computer has; null for a project with no music. */
export interface MusicModels {
  model: MusicModelId
  installed: Record<MusicModelId, boolean>
  /** The length in seconds of every loop track, as it is in force (the studio's changes included). */
  loops: number[]
}

const encoder = new TextEncoder()

/**
 * Reads every part in every declared language and totals the dialog (each line once: how many,
 * and the bytes Fish would be sent for it) and, for the lines with a clip the lock knows, the
 * lines and bytes by the model they were made with. A part without a readable dialog counts for
 * nothing; a line not yet translated is not a line.
 */
export async function modelsView(
  projectFile: string,
  installed: (model: MusicModelId) => boolean | Promise<boolean> = () => true,
): Promise<ModelsView> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const dialog: Dialog = { lines: 0, bytes: 0 }
  const recorded: Recorded = {}
  for (const part of project.narration.parts) {
    for (const language of project.narration.languages) {
      const read = await readPart(projectFile, part.id, language)
      if (!read?.ok || read.dialog.status !== 'ok') continue
      const { input } = read
      const state = planPart(input)
      for (const line of state.lines) {
        if (line.status === 'untranslated') continue
        const bytes = spokenPieces(
          line.text,
          line.cue,
          input.cast.pronounce,
          project.narration.quality.chunkLimit,
          line.inside,
        ).reduce((sum, text) => sum + encoder.encode(text).length, 0)
        dialog.lines++
        dialog.bytes += bytes
        const made = input.lock[line.key]?.model
        if (line.file && made) {
          const got = (recorded[made] ??= { lines: 0, bytes: 0 })
          got.lines++
          got.bytes += bytes
        }
      }
    }
  }
  return {
    ok: true,
    file: basename(projectFile),
    models: project.narration.models,
    dialog,
    recorded,
    music: project.music
      ? {
          loops: (await readMusic(dirname(projectFile), project, []))!.lists
            .filter((list) => list.kind === 'act')
            .flatMap((list) => list.tracks.map((track) => track.seconds)),
          model: project.music.model ?? DEFAULT_MUSIC_MODEL,
          installed: Object.fromEntries(
            await Promise.all(MUSIC_MODELS.map(async ({ id }) => [id, await installed(id)])),
          ) as Record<MusicModelId, boolean>,
        }
      : null,
  }
}
