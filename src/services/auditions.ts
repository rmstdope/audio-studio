import { dirname } from 'node:path'
import { formatCast } from '../core/castFormat'
import type { Problem } from '../core/project'
import { CastSchema, type Cast, type Character } from '../core/resources'
import type { CharacterSummary } from '../core/summary'
import type { Candidate, Voice } from '../core/voiceSearch'
import type { FishClient } from './fish'
import { readResource, writeAtomic } from './files'
import { searchVoices } from './voiceSearch'
import { loadProject, openProject, type ProjectFailure } from './workspace'

/** How many candidates an audition search returns at most. */
export const CANDIDATE_LIMIT = 24

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

/**
 * Searches Fish's library with a character's audition keywords, leaving out its current voice.
 * `fish` is null when there is no API key.
 */
export async function findCandidates(
  projectFile: string,
  characterId: string,
  fish: FishClient | null,
): Promise<CandidatesResult> {
  const loaded = await loadProject(projectFile)
  if (!loaded.ok) return loaded
  const character = loaded.summary.characters.find((c) => c.id === characterId)
  if (!character) return null
  if (!fish) {
    return {
      ok: false,
      reason: 'no-key',
      message: 'Set FISH_AUDIO_API_KEY in the project’s env file, or in the environment.',
    }
  }
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const language = opened.project.narration.audition.language
  const keywords = character.keywords
  try {
    const current = character.voice ? await fish.getVoice(character.voice).catch(() => null) : null
    const exclude = new Set(character.voice ? [character.voice] : [])
    const candidates = keywords.length
      ? await searchVoices(fish, keywords, { language, exclude })
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
    return { ok: false, reason: 'fish', message: (error as Error).message }
  }
}

/** What changing a character did, or why it did nothing. Null for an unknown character. */
export type CharacterChange =
  { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** Saves a character's audition keywords in the cast: trimmed, without empties or repeats. */
export function setKeywords(
  projectFile: string,
  characterId: string,
  keywords: string[],
): Promise<CharacterChange> {
  const cleaned = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))]
  return updateCharacter(projectFile, characterId, (entry) => ({
    ...entry,
    audition: { ...entry.audition, keywords: cleaned },
  }))
}

/**
 * Changes one character's entry in the cast and writes the cast back, in its own layout. The
 * character must be in the project (in the cast or speaking in a part); a speaker not in the cast
 * yet gets an entry. Refuses to write over a cast that cannot be read.
 */
async function updateCharacter(
  projectFile: string,
  characterId: string,
  change: (entry: Character) => Character,
): Promise<CharacterChange> {
  const loaded = await loadProject(projectFile)
  if (!loaded.ok) return loaded
  if (!loaded.summary.characters.some((c) => c.id === characterId)) return null
  const root = dirname(projectFile)
  const path = loaded.summary.charactersPath
  const problems: Problem[] = []
  const read = await readResource(root, path, CastSchema, problems)
  if (read === 'invalid') return { ok: false, problems }
  const cast: Cast = read === 'missing' ? { speakers: {}, pronounce: {} } : read
  const speakers = { ...cast.speakers, [characterId]: change(cast.speakers[characterId] ?? {}) }
  await writeAtomic(root, path, formatCast({ ...cast, speakers }))
  return { ok: true }
}
