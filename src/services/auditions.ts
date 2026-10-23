import { dirname } from 'node:path'
import { formatCast } from '../core/castFormat'
import { resolveInRoot } from '../core/paths'
import { problemsFrom, type Problem, type Project } from '../core/project'
import { CastSchema, type Character } from '../core/resources'
import type { CharacterSummary } from '../core/summary'
import { hasWords, type Candidate, type Voice } from '../core/voiceSearch'
import type { FishClient } from './fish'
import { readJson, writeAtomic } from './files'
import { searchVoices } from './voiceSearch'
import { loadWorkspace, type ProjectFailure } from './workspace'

/** How many candidates an audition search returns at most. */
export const CANDIDATE_LIMIT = 24

/** Makes the Fish client for a project, or null when there is no API key. */
export type FishFactory = (root: string, project: Project) => Promise<FishClient | null>

/** Voices found for a character, or why there are none. Null for an unknown character. */
export type CandidatesResult =
  | {
      ok: true
      character: CharacterSummary
      keywords: string[]
      language: string
      /** The character's current voice, if it has one and Fish still has it. */
      current: Voice | null
      candidates: Candidate[]
    }
  | { ok: false; reason: 'no-key' | 'fish'; message: string }
  | ProjectFailure
  | null

/** Searches Fish's library with a character's audition keywords, leaving out its current voice. */
export async function findCandidates(
  projectFile: string,
  characterId: string,
  fishFor: FishFactory,
): Promise<CandidatesResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  const { project, summary } = loaded
  const character = summary.characters.find((c) => c.id === characterId)
  if (!character) return null
  const fish = await fishFor(dirname(projectFile), project)
  if (!fish) {
    return {
      ok: false,
      reason: 'no-key',
      message: 'Set FISH_AUDIO_API_KEY in the project’s env file, or in the environment.',
    }
  }
  const { language } = project.narration.audition
  const keywords = character.keywords
  try {
    const current = character.voice ? await fish.getVoice(character.voice).catch(() => null) : null
    const exclude = new Set(character.voice ? [character.voice] : [])
    const candidates = keywords.length
      ? await searchVoices(fish, keywords, {
          language,
          exclude,
          parallel: project.narration.quality.parallel,
        })
      : []
    return {
      ok: true,
      character,
      keywords,
      language,
      current,
      candidates: candidates.slice(0, CANDIDATE_LIMIT),
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'fish',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** What changing a character did, or why it did nothing. Null for an unknown character. */
export type CharacterChange =
  { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/**
 * Saves a character's audition keywords in the cast: trimmed, without ones that have no words,
 * and once each regardless of case (the first spelling is kept).
 */
export function setKeywords(
  projectFile: string,
  characterId: string,
  keywords: string[],
): Promise<CharacterChange> {
  const seen = new Set<string>()
  const cleaned = keywords
    .map((k) => k.trim())
    .filter((k) => hasWords(k) && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
  return updateCharacter(projectFile, characterId, (entry) => ({
    ...entry,
    audition: { ...entry.audition, keywords: cleaned },
  }))
}

/**
 * Writes in progress per project (one server serves one project, with one cast file), so changes
 * made at once are applied one after the other. Every cast writer must go through
 * `updateCharacter`.
 */
const castWrites = new Map<string, Promise<unknown>>()

/**
 * Changes one character's entry in the cast and writes the cast back, in its own layout, leaving
 * everything else as it was. The character must be in the project (in the cast or speaking in a
 * part); a speaker not in the cast yet gets an entry. Changes to a project's cast are applied one at
 * a time, each on what the one before wrote.
 */
function updateCharacter(
  projectFile: string,
  characterId: string,
  change: (entry: Character) => Character,
): Promise<CharacterChange> {
  const key = projectFile
  const previous = castWrites.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(() => writeCharacter(projectFile, characterId, change))
  castWrites.set(key, next)
  return next.finally(() => {
    if (castWrites.get(key) === next) castWrites.delete(key)
  })
}

/** Pronunciation keys JavaScript would move to the front, changing the order they apply in. */
const INTEGER_LIKE = /^(0|[1-9]\d*)$/

async function writeCharacter(
  projectFile: string,
  characterId: string,
  change: (entry: Character) => Character,
): Promise<CharacterChange> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  if (!loaded.summary.characters.some((c) => c.id === characterId)) return null
  const root = dirname(projectFile)
  const path = loaded.project.narration.characters

  // Change the cast as it is in the file, not as parsed with defaults, so nothing else changes.
  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'invalid') {
    return { ok: false, problems: [{ file: path, path: '', message: json.message }] }
  }
  const raw = json.status === 'missing' ? { speakers: {}, pronounce: {} } : json.value
  const parsed = CastSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, problems: problemsFrom(path, parsed.error) }
  // Only `pronounce` is checked: it is the one place where order matters. With a single entry
  // nothing can move; with more, parsing has already lost the file's order, so refuse.
  const keys = Object.keys(parsed.data.pronounce)
  const reordered = keys.filter((k) => INTEGER_LIKE.test(k))
  if (reordered.length && keys.length > 1) {
    return {
      ok: false,
      problems: [
        {
          file: path,
          path: 'pronounce',
          message:
            `the pronunciation of ${reordered.map((k) => `"${k}"`).join(', ')} would move to the ` +
            'top if the studio wrote this file, changing the order pronunciations apply in. ' +
            'Make the key longer, e.g. "Act 10" or "10 " (any key that is not a plain number ' +
            'keeps its place), or edit the file by hand.',
        },
      ],
    }
  }

  const cast = raw as Record<string, unknown> & { speakers?: Record<string, Character> }
  const speakers = { ...cast.speakers }
  speakers[characterId] = change(speakers[characterId] ?? {})
  await writeAtomic(root, path, formatCast({ ...cast, speakers }))
  return { ok: true }
}
