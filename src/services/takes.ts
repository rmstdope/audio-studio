import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveInRoot } from '../core/paths'
import { phraseProblem, type Problem, type Project } from '../core/project'
import type { Cast } from '../core/resources'
import { auditionText, takeKey, type AuditionText } from '../core/takes'
import type { FishFactory } from './auditions'
import { writeAtomic } from './files'
import type { Limiter } from './limit'
import { loadWorkspace } from './workspace'
import { NO_KEY } from './fish'

/** Where audition takes are kept, in the project's tool cache (gitignored by the consumer). */
export const TAKES_DIR = '.audio-studio/takes'

/** A recorded take (its key, and the text it is of), or why there is none. Null for an unknown character. */
export type TakeResult =
  | { ok: true; key: string; spoken: string; cached: boolean }
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
  const { project, cast, summary } = loaded
  if (!summary.characters.some((c) => c.id === characterId)) return null
  if (!cast) return { ok: false, problems: castProblems(project, summary.problems) }

  const root = dirname(projectFile)
  const text = auditionFor(cast, characterId, project)
  // A phrase edited into the cast by hand is checked too: never pay for a take that is too long.
  const tooLong = phraseProblem(text.phrase, project.narration.quality.chunkLimit)
  if (tooLong) {
    const where = text.own ? phrasePath(characterId) : 'narration.audition.phrase'
    const file = text.own ? project.narration.characters : basename(projectFile)
    return { ok: false, problems: [{ file, path: where, message: tooLong }] }
  }
  const key = takeOf(project, voiceId, text)
  const file = resolveInRoot(root, takePath(key))
  const recorded = { ok: true as const, key, spoken: text.spoken }
  if (existsSync(file)) return { ...recorded, cached: true }

  const fish = await fishFor(root, project)
  if (!fish) {
    return {
      ok: false,
      reason: 'no-key',
      message: NO_KEY,
    }
  }
  const { tts, models, quality } = project.narration
  try {
    const cached = await limiter.run(key, quality.parallel, async () => {
      // Another request may have recorded it while this one waited: never pay for it twice.
      if (existsSync(file)) return true
      const audio = await fish.tts({
        text: text.spoken,
        voice: voiceId,
        model: models.audition,
        temperature: tts.temperature,
        topP: tts.topP,
        speed: tts.speed,
      })
      if (!audio.length) throw new Error('Fish Audio sent no audio')
      await writeAtomic(root, takePath(key), audio)
      return false
    })
    return { ...recorded, cached }
  } catch (error) {
    return {
      ok: false,
      reason: 'fish',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** The audition phrase and the takes already recorded for it, by voice, or why not. */
export type AuditionTakesResult =
  | { ok: true; audition: AuditionText; takes: Record<string, string> }
  | { ok: false; problems: Problem[] }
  | null

/** A character's audition phrase and which of `voiceIds` already have a take of it. */
export async function auditionTakes(
  projectFile: string,
  characterId: string,
  voiceIds: string[],
): Promise<AuditionTakesResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return { ok: false, problems: loaded.problems }
  const { project, cast, summary } = loaded
  if (!summary.characters.some((c) => c.id === characterId)) return null
  if (!cast) return { ok: false, problems: castProblems(project, summary.problems) }
  const audition = auditionFor(cast, characterId, project)
  return {
    ok: true,
    audition,
    takes: recordedTakes(dirname(projectFile), project, audition, voiceIds),
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
    if (existsSync(resolveInRoot(root, takePath(key)))) takes[voice] = key
  }
  return takes
}

/** The file of a recorded take, or null if the key is not a take key or has no file. */
export async function takeFile(projectFile: string, key: string): Promise<string | null> {
  if (!/^[0-9a-f]{16}$/.test(key)) return null
  const file = join(resolveInRoot(dirname(projectFile), TAKES_DIR), `${key}.mp3`)
  return existsSync(file) ? file : null
}

/** The problems of the cast file, out of all the project's. */
export function castProblems(project: Project, problems: Problem[]): Problem[] {
  return problems.filter((problem) => problem.file === project.narration.characters)
}

/** Where a character's own phrase is in the cast, as a problem path. */
export function phrasePath(characterId: string): string {
  const id = /^[A-Za-z_][\w-]*$/.test(characterId)
    ? `.${characterId}`
    : `[${JSON.stringify(characterId)}]`
  return `speakers${id}.audition.phrase`
}

function takePath(key: string): string {
  return `${TAKES_DIR}/${key}.mp3`
}

function takeOf(project: Project, voice: string, text: AuditionText): string {
  const { models, tts } = project.narration
  return takeKey({ model: models.audition, voice, spoken: text.spoken, tts })
}
