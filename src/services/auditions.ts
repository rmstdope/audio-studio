import { dirname } from 'node:path'
import { formatCast } from '../core/castFormat'
import { resolveInRoot } from '../core/paths'
import { phraseProblem, problemsFrom, type Problem, type Project } from '../core/project'
import {
  INTEGER_LIKE,
  cleanPronunciations,
  pronounceProblem,
  sameTable,
  type Pronunciation,
} from '../core/pronounce'
import { CastSchema, type Cast, type Character } from '../core/resources'
import type { CharacterSummary } from '../core/summary'
import type { AuditionText } from '../core/takes'
import { hasWords, type Candidate, type Voice } from '../core/voiceSearch'
import type { FishClient } from './fish'
import { readJson, writeAtomic } from './files'
import { auditionFor, castProblems, phrasePath, recordedTakes } from './takes'
import { createSerial } from './serial'
import { searchVoices } from './voiceSearch'
import { loadWorkspace, openProject, type ProjectFailure } from './workspace'

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
      /** What the character says in a take. */
      audition: AuditionText
      /** Takes already recorded for this phrase, by voice id. */
      takes: Record<string, string>
      /** How many candidates a round has (the project's `audition.candidatesPerRound`). */
      perRound: number
    }
  | { ok: false; reason: 'no-key' | 'fish'; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/** How to search for candidates other than with the character's keywords, leaving out its voice. */
export interface SearchOptions {
  /** Keywords to search with instead of the character's (e.g. the ones an audition started with). */
  keywords?: string[]
  /** More voices to leave out (e.g. every voice an audition has already shown). */
  exclude?: Iterable<string>
}

/** Searches Fish's library with a character's audition keywords, leaving out its current voice. */
export async function findCandidates(
  projectFile: string,
  characterId: string,
  fishFor: FishFactory,
  options: SearchOptions = {},
): Promise<CandidatesResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  const { project, summary, cast } = loaded
  const character = summary.characters.find((c) => c.id === characterId)
  if (!character) return null
  // Without the cast the phrase, style and pronunciations are unknown: say so, don't guess.
  if (!cast) return { ok: false, problems: castProblems(project, summary.problems) }
  const fish = await fishFor(dirname(projectFile), project)
  if (!fish) {
    return {
      ok: false,
      reason: 'no-key',
      message: 'Set FISH_AUDIO_API_KEY in the project’s env file, or in the environment.',
    }
  }
  const { language } = project.narration.audition
  const keywords = options.keywords ?? character.keywords
  try {
    const current = character.voice ? await fish.getVoice(character.voice).catch(() => null) : null
    // Left out before the list is cut, so a later search reaches voices past the first ones.
    const exclude = new Set([
      ...(character.voice ? [character.voice] : []),
      ...(options.exclude ?? []),
    ])
    const found = keywords.length
      ? await searchVoices(fish, keywords, {
          language,
          exclude,
          parallel: project.narration.quality.parallel,
        })
      : []
    const candidates = found.slice(0, CANDIDATE_LIMIT)
    const root = dirname(projectFile)
    const audition = auditionFor(cast, characterId, project)
    const voices = [...(current ? [current.id] : []), ...candidates.map((c) => c.voice.id)]
    return {
      ok: true,
      character,
      keywords,
      language,
      current,
      candidates,
      audition,
      takes: recordedTakes(root, project, audition, voices),
      perRound: project.narration.audition.candidatesPerRound,
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
  return updateCharacter(projectFile, characterId, (entry) =>
    withAudition(entry, { keywords: cleaned.length ? cleaned : undefined }),
  )
}

/**
 * Saves a character's style cue in the cast (the delivery of every line without its own cue),
 * trimmed; an empty style removes it. The entry keeps its other fields and their order.
 */
export function setStyle(
  projectFile: string,
  characterId: string,
  style: string,
): Promise<CharacterChange> {
  const own = style.trim()
  return updateCharacter(projectFile, characterId, (entry) => {
    if (own) return { ...entry, style: own }
    const { style: _removed, ...rest } = entry
    return rest
  })
}

/** Saves a character's own audition phrase in the cast; an empty phrase goes back to the standard one. */
export async function setPhrase(
  projectFile: string,
  characterId: string,
  phrase: string | null,
): Promise<CharacterChange> {
  const own = phrase?.trim() || undefined
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  if (!loaded.summary.characters.some((c) => c.id === characterId)) return null
  const { narration } = loaded.project
  const tooLong = own ? phraseProblem(own, narration.quality.chunkLimit) : null
  if (tooLong) {
    const problem = { file: narration.characters, path: phrasePath(characterId), message: tooLong }
    return { ok: false, problems: [problem] }
  }
  return updateCharacter(projectFile, characterId, (entry) => withAudition(entry, { phrase: own }))
}

/**
 * A character entry with audition fields changed; a field that is undefined or null is removed, and an
 * audition left empty is removed too, so clearing a field leaves no trace in the cast.
 */
function withAudition(
  entry: Character,
  changes: { keywords?: string[]; phrase?: string },
): Character {
  const audition: Record<string, unknown> = { ...entry.audition, ...changes }
  for (const key of Object.keys(audition)) if (audition[key] == null) delete audition[key]
  const keep = Object.keys(audition).length > 0
  if (!('audition' in entry)) return keep ? { ...entry, audition } : entry
  // Keep the entry's own order: the audition stays where it was.
  return Object.fromEntries(
    Object.entries(entry).flatMap(([key, value]) =>
      key !== 'audition' ? [[key, value]] : keep ? [[key, audition]] : [],
    ),
  )
}

/** Casts a voice for a character: its id and name in the cast; style and the rest stay as they are. */
export function setVoice(
  projectFile: string,
  characterId: string,
  voice: { id: string; name: string },
): Promise<CharacterChange> {
  return updateCharacter(projectFile, characterId, (entry) => {
    if (!('voice' in entry)) {
      const { voiceName: _old, ...rest } = entry
      return { ...rest, voice: voice.id, voiceName: voice.name }
    }
    // The voice stays where it was, its name right after it.
    return Object.fromEntries(
      Object.entries(entry).flatMap(([key, value]): [string, unknown][] =>
        key === 'voice'
          ? [
              ['voice', voice.id],
              ['voiceName', voice.name],
            ]
          : key === 'voiceName'
            ? []
            : [[key, value]],
      ),
    )
  })
}

/**
 * Writes in progress per project (one server serves one project, with one cast file), so changes
 * made at once are applied one after the other. Every cast write goes through it, by way of
 * `writeCast`.
 */
const castWrites = createSerial()

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
  return castWrites.run(projectFile, () => writeCharacter(projectFile, characterId, change))
}

async function writeCharacter(
  projectFile: string,
  characterId: string,
  change: (entry: Character) => Character,
): Promise<CharacterChange> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  if (!loaded.summary.characters.some((c) => c.id === characterId)) return null
  return writeCast(projectFile, (cast, parsed, path) => {
    // A number-like pronunciation among others: parsing has already lost the file's order, so
    // writing would change the order they apply in. The table itself can be fixed on its own.
    const keys = Object.keys(parsed.pronounce)
    const reordered = keys.filter((k) => INTEGER_LIKE.test(k))
    if (reordered.length && keys.length > 1) {
      const message =
        `the pronunciation of ${reordered.map((k) => `"${k}"`).join(', ')} would move to the ` +
        'top if the studio wrote this file, changing the order pronunciations apply in. Make ' +
        'the key longer under Pronunciations on All characters, e.g. "Act 10" or "10 " (any key ' +
        'that is not a plain number keeps its place).'
      return [{ file: path, path: 'pronounce', message }]
    }
    const speakers = { ...cast.speakers }
    speakers[characterId] = change(speakers[characterId] ?? {})
    return { ...cast, speakers }
  })
}

/** The cast as it is in the file: only `speakers` and `pronounce` are known, the rest is kept. */
type RawCast = Record<string, unknown> & { speakers?: Record<string, Character> }

/**
 * Changes the cast as it is in the file (not as parsed with defaults, so nothing else changes)
 * and writes it back in its own layout. `change` gets the raw cast, the parsed one and the cast's
 * path, and gives the new cast or the problems that stop it.
 */
async function writeCast(
  projectFile: string,
  change: (raw: RawCast, parsed: Cast, path: string) => RawCast | Problem[],
): Promise<CharacterChange> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const root = dirname(projectFile)
  const path = opened.project.narration.characters

  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'invalid') {
    return { ok: false, problems: [{ file: path, path: '', message: json.message }] }
  }
  const raw = json.status === 'missing' ? { speakers: {}, pronounce: {} } : json.value
  const parsed = CastSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, problems: problemsFrom(path, parsed.error) }
  const changed = change(raw as RawCast, parsed.data, path)
  if (Array.isArray(changed)) return { ok: false, problems: changed }
  await writeAtomic(root, path, formatCast(changed))
  return { ok: true }
}

/**
 * Saves the pronunciation table, in the order given (empty rows dropped, spaces kept). `was` is
 * the table the editing began from: if the file's differs, someone changed it meanwhile, and
 * nothing is written. The new table is checked itself, so a number-like key the character
 * setters refuse can be fixed here. Every line whose words as said change shows as stale.
 */
export function setPronunciations(
  projectFile: string,
  table: Pronunciation[],
  was: Pronunciation[],
): Promise<CharacterChange> {
  const clean = cleanPronunciations(table)
  return castWrites.run(projectFile, () =>
    writeCast(projectFile, (raw, parsed, path) => {
      const problem = (message: string): Problem[] => [{ file: path, path: 'pronounce', message }]
      if (!sameTable(Object.entries(parsed.pronounce), was)) {
        return problem(
          'the pronunciations in the file changed since editing began; discard your changes to see them',
        )
      }
      const why = pronounceProblem(clean)
      if (why) return problem(why)
      return { ...raw, pronounce: Object.fromEntries(clean) }
    }),
  )
}
