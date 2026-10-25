import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveInRoot } from '../core/paths'
import { phraseProblem, type Problem, type Project } from '../core/project'
import { ttsFor, type Cast } from '../core/resources'
import { auditionText, takeKey, type AuditionText } from '../core/takes'
import { spokenText } from '../core/spoken'
import type { FishFactory } from './auditions'
import { writeAtomic } from './files'
import type { Limiter } from './limit'
import { loadWorkspace, readPart, type ProjectFailure } from './workspace'
import { NO_KEY } from './fish'

/** Where audition takes are kept, in the project's tool cache (gitignored by the consumer). */
export const TAKES_DIR = '.audio-studio/takes'

/** A recorded take (its key, and the text it is of), or why there is none. Null for an unknown character. */
export type TakeResult =
  | { ok: true; key: string; spoken: string; cached: boolean }
  | { ok: false; reason: 'no-key' | 'fish' | 'no-phrase'; message: string }
  | { ok: false; problems: Problem[] }
  | null

/** A line tried with a cue: a take of it, or why there is none. Null for an unknown part or line. */
export type TryResult =
  TakeResult | { ok: false; reason: 'uncast'; message: string } | ProjectFailure

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
  if (text.phrase === null) {
    return { ok: false, reason: 'no-phrase', message: 'There is no audition phrase to record.' }
  }
  // A phrase edited into the cast by hand is checked too: never pay for a take that is too long.
  const tooLong = phraseProblem(text.phrase, project.narration.quality.chunkLimit)
  if (tooLong) {
    const where = text.from === 'own' ? phrasePath(characterId) : 'narration.audition.phrase'
    const file = text.from === 'own' ? project.narration.characters : basename(projectFile)
    return { ok: false, problems: [{ file, path: where, message: tooLong }] }
  }
  const tts = ttsFor(project.narration.tts, cast.speakers[characterId])
  return speak(root, project, voiceId, text.spoken, tts, fishFor, limiter)
}

/**
 * Hears a line with a cue before the cue is saved: the speaker's cast voice says the line, as
 * the cast says it, after the cue (empty: the character's style, as a line without its own cue
 * is said). A try is a take: recorded with the audition model (free), the whole line in one
 * request (Fish splits long text itself), and kept in the tool cache, so the same cue on the same
 * line is recorded once. Nothing of the game's is written.
 */
export async function tryLine(
  projectFile: string,
  partId: string,
  key: string,
  cue: string,
  fishFor: FishFactory,
  limiter: Limiter,
): Promise<TryResult> {
  const read = await readPart(projectFile, partId)
  if (!read || !read.ok) return read
  // Only the cast is needed besides the dialog (a line of a broken dialog is not found): a broken
  // manifest or lock, which the lines page lists lines under, does not stop a try.
  const problems = castProblems(read.project, read.problems)
  if (problems.length) return { ok: false, problems }
  const line = read.input.lines.find((l) => l.key === key)
  if (!line) return null
  const { cast } = read.input
  const character = cast.speakers[line.speaker]
  if (!character?.voice) {
    return {
      ok: false,
      reason: 'uncast',
      message: `${line.speaker} has no voice yet; cast one first.`,
    }
  }
  const tried = cue.trim() || (character.style ?? '')
  const spoken = spokenText(line.text, tried, cast.pronounce)
  const tts = ttsFor(read.project.narration.tts, character)
  return speak(dirname(projectFile), read.project, character.voice, spoken, tts, fishFor, limiter)
}

/**
 * `voice` saying `spoken` with the audition model at `tts` (the character's settings), kept in
 * the tool cache under its take key; a take already there is not recorded again, and requests
 * for the same take share one recording.
 */
async function speak(
  root: string,
  project: Project,
  voice: string,
  spoken: string,
  tts: Project['narration']['tts'],
  fishFor: FishFactory,
  limiter: Limiter,
): Promise<TakeResult> {
  const { models, quality } = project.narration
  const key = takeKey({ model: models.audition, voice, spoken, tts })
  const file = resolveInRoot(root, takePath(key))
  const recorded = { ok: true as const, key, spoken }
  if (existsSync(file)) return { ...recorded, cached: true }

  const fish = await fishFor(root, project)
  if (!fish) {
    return {
      ok: false,
      reason: 'no-key',
      message: NO_KEY,
    }
  }
  try {
    const cached = await limiter.run(key, quality.parallel, async () => {
      // Another request may have recorded it while this one waited: never pay for it twice.
      if (existsSync(file)) return true
      const audio = await fish.tts({ text: spoken, voice, model: models.audition, ...tts })
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
    takes: recordedTakes(dirname(projectFile), project, cast, characterId, audition, voiceIds),
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
  cast: Cast,
  characterId: string,
  text: AuditionText,
  voiceIds: string[],
): Record<string, string> {
  const takes: Record<string, string> = {}
  for (const voice of voiceIds) {
    const key = takeOf(project, voice, text, cast, characterId)
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
export function phrasePath(characterId: string, language?: string): string {
  const id = /^[A-Za-z_][\w-]*$/.test(characterId)
    ? `.${characterId}`
    : `[${JSON.stringify(characterId)}]`
  return language === undefined
    ? `speakers${id}.audition.phrase`
    : `speakers${id}.languages.${language}.phrase`
}

function takePath(key: string): string {
  return `${TAKES_DIR}/${key}.mp3`
}

function takeOf(
  project: Project,
  voice: string,
  text: AuditionText,
  cast: Cast,
  characterId: string,
): string {
  const { models, tts } = project.narration
  return takeKey({
    model: models.audition,
    voice,
    spoken: text.spoken,
    tts: ttsFor(tts, cast.speakers[characterId]),
  })
}
