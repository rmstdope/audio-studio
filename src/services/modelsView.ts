import { basename } from 'node:path'
import type { Dialog, Recorded, StageModels } from '../core/models'
import { planPart } from '../core/planner'
import { spokenPieces } from '../core/spoken'
import { openProject, readPart, type ProjectFailure } from './workspace'

/** What the Models panel needs: the models, the whole dialog, and what recorded clips were made with. */
export type ModelsView =
  | { ok: true; file: string; models: StageModels; dialog: Dialog; recorded: Recorded }
  | ProjectFailure

const encoder = new TextEncoder()

/**
 * Reads every part in every declared language and totals the dialog (each line once: how many,
 * and the bytes Fish would be sent for it) and, for the lines with a clip the lock knows, the
 * lines and bytes by the model they were made with. A part without a readable dialog counts for
 * nothing; a line not yet translated is not a line.
 */
export async function modelsView(projectFile: string): Promise<ModelsView> {
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
  }
}
