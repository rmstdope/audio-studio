import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveInRoot } from '../core/paths'
import type { Problem, Project } from '../core/project'
import { CastSchema, type Cast } from '../core/resources'
import { auditionText, takeKey, type AuditionText } from '../core/takes'
import type { FishFactory } from './auditions'
import { readResource, writeAtomic } from './files'
import type { Limiter } from './limit'
import { loadWorkspace } from './workspace'

/** Where audition takes are kept, in the project's tool cache (gitignored by the consumer). */
export const TAKES_DIR = '.audio-studio/takes'

/** A recorded take, or why there is none. Null for an unknown character. */
export type TakeResult =
  | { ok: true; key: string; cached: boolean }
  | { ok: false; reason: 'no-key' | 'fish'; message: string }
  | { ok: false; problems: Problem[] }
  | null

/**
 * Has `voiceId` say the character's audition phrase, in its style, with the audition model, and
 * keeps the audio in the tool cache. A take already recorded is not recorded again, and requests
 * for the same take share one recording; at most `quality.parallel` are recorded at once.
 */
export async function recordTake(
  projectFile: string,
  characterId: string,
  voiceId: string,
  fishFor: FishFactory,
  limiter: Limiter,
): Promise<TakeResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return { ok: false, problems: loaded.problems }
  const { project } = loaded
  if (!loaded.summary.characters.some((c) => c.id === characterId)) return null
  const root = dirname(projectFile)
  const problems: Problem[] = []
  const cast = await readCast(root, project, problems)
  if (!cast) return { ok: false, problems }

  const text = auditionFor(cast, characterId, project)
  const key = takeOf(project, voiceId, text)
  const path = `${TAKES_DIR}/${key}.mp3`
  if (existsSync(resolveInRoot(root, path))) return { ok: true, key, cached: true }

  const fish = await fishFor(root, project)
  if (!fish) {
    return {
      ok: false,
      reason: 'no-key',
      message: 'Set FISH_AUDIO_API_KEY in the project’s env file, or in the environment.',
    }
  }
  const { tts, models, quality } = project.narration
  try {
    await limiter.run(key, quality.parallel, async () => {
      const audio = await fish.tts({
        text: text.spoken,
        voice: voiceId,
        model: models.audition,
        temperature: tts.temperature,
        topP: tts.topP,
        speed: tts.speed,
      })
      await writeAtomic(root, path, audio)
    })
    return { ok: true, key, cached: false }
  } catch (error) {
    return {
      ok: false,
      reason: 'fish',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** The audition phrase of a character in the cast (or of a speaker not in it yet). */
export function auditionFor(cast: Cast, characterId: string, project: Project): AuditionText {
  return auditionText(cast.speakers[characterId] ?? {}, cast.pronounce, project.narration)
}

/** The keys of the takes already recorded, by voice, for the character's current phrase. */
export function recordedTakes(
  root: string,
  project: Project,
  text: AuditionText,
  voiceIds: string[],
): Record<string, string> {
  const takes: Record<string, string> = {}
  for (const voice of voiceIds) {
    const key = takeOf(project, voice, text)
    if (existsSync(resolveInRoot(root, `${TAKES_DIR}/${key}.mp3`))) takes[voice] = key
  }
  return takes
}

/** The file of a recorded take, or null if the key is not a take key or has no file. */
export async function takeFile(projectFile: string, key: string): Promise<string | null> {
  if (!/^[0-9a-f]{16}$/.test(key)) return null
  const file = join(resolveInRoot(dirname(projectFile), TAKES_DIR), `${key}.mp3`)
  return existsSync(file) ? file : null
}

/** The project's cast, or null (with the problem added) if it is broken; empty if there is none. */
export async function readCast(
  root: string,
  project: Project,
  problems: Problem[],
): Promise<Cast | null> {
  const read = await readResource(root, project.narration.characters, CastSchema, problems)
  if (read === 'invalid') return null
  return read === 'missing' ? { speakers: {}, pronounce: {} } : read
}

function takeOf(project: Project, voice: string, text: AuditionText): string {
  const { models, tts } = project.narration
  return takeKey({ model: models.audition, voice, spoken: text.spoken, tts })
}
