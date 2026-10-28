import { basename, dirname } from 'node:path'
import type { Dialog, Recorded, StageModels } from '../core/models'
import { DEFAULT_MUSIC_MODEL, MUSIC_MODELS, type MusicModelId } from '../core/musicModels'
import { planPart } from '../core/planner'
import type { ElevenTts } from '../core/project'
import { sentPieces, spokenPieces } from '../core/spoken'
import { providerOf } from '../core/voices'
import { readMusic } from './musicLists'
import { openProject, readPart, type ProjectFailure } from './workspace'

/** What the Models panel needs: the models, the whole dialog, and what recorded clips were made with. */
export type ModelsView =
  | {
      ok: true
      file: string
      models: StageModels
      /** ElevenLabs' stage models, for characters with ElevenLabs voices. */
      elevenlabs: StageModels
      /** The voice settings every ElevenLabs voice speaks with. */
      elevenTts: ElevenTts
      /** Whether any character has an ElevenLabs voice, in any language. */
      castsEleven: boolean
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
  let castsEleven = false
  for (const part of project.narration.parts) {
    for (const language of project.narration.languages) {
      const read = await readPart(projectFile, part.id, language)
      if (!read?.ok || read.dialog.status !== 'ok') continue
      const { input } = read
      castsEleven ||= Object.values(input.cast.speakers).some(
        (character) =>
          character.voice !== undefined && providerOf(character.voice) === 'elevenlabs',
      )
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
          // What the clip was sent, on the model it was made with (no cues for one that speaks them).
          const sent = sentPieces(
            line,
            made,
            input.cast.pronounce,
            project.narration.quality.chunkLimit,
          )
          const { pronounce } = input.cast
          const { chunkLimit } = project.narration.quality
          const count = (texts: string[]) => texts.reduce((sum, text) => sum + [...text].length, 0)
          const got = (recorded[made] ??= { lines: 0, bytes: 0, characters: 0, bare: 0 })
          got.lines++
          got.bytes += sent.reduce((sum, text) => sum + encoder.encode(text).length, 0)
          got.characters += count(
            spokenPieces(line.text, line.cue, pronounce, chunkLimit, line.inside),
          )
          got.bare += count(spokenPieces(line.text, '', pronounce, chunkLimit))
        }
      }
    }
  }
  return {
    ok: true,
    file: basename(projectFile),
    models: project.narration.models,
    elevenlabs: project.narration.elevenlabs.models,
    elevenTts: project.narration.elevenlabs.tts,
    castsEleven,
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
