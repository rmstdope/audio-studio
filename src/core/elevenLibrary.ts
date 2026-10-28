import { z } from 'zod'

/** What ElevenLabs' library is searched with besides the words: the gender and age asked for. */
export interface LibraryFilters {
  gender?: 'male' | 'female'
  age?: 'young' | 'middle_aged' | 'old'
}

/** Words in a character's keywords that name a gender or an age, as ElevenLabs' library files them. */
const GENDERS: Record<string, 'male' | 'female'> = {
  male: 'male',
  man: 'male',
  boy: 'male',
  masculine: 'male',
  female: 'female',
  woman: 'female',
  girl: 'female',
  feminine: 'female',
}
const AGES: Record<string, 'young' | 'middle_aged' | 'old'> = {
  young: 'young',
  child: 'young',
  teen: 'young',
  teenage: 'young',
  boy: 'young',
  girl: 'young',
  'middle-aged': 'middle_aged',
  old: 'old',
  elderly: 'old',
}

/** The keywords' words, lower case, "middle aged" kept as one. */
function keywordWords(keywords: string[]): string[] {
  return keywords.flatMap(
    (k) =>
      k
        .toLowerCase()
        .replace(/middle\s+aged/gu, 'middle-aged')
        .match(/[\p{L}-]+/gu) ?? [],
  )
}

/** The gender or age in `table` the words name, if they name exactly one. */
function namedOnce<T>(words: string[], table: Record<string, T>): T | undefined {
  const named = new Set(words.flatMap((w) => (table[w] ? [table[w]] : [])))
  return named.size === 1 ? [...named][0] : undefined
}

/**
 * The gender and age to search ElevenLabs' library for, from the keywords: each only when the
 * keywords name exactly one (as whole words: "human" names no man).
 */
export function libraryFilters(keywords: string[]): LibraryFilters {
  const words = keywordWords(keywords)
  const gender = namedOnce(words, GENDERS)
  const age = namedOnce(words, AGES)
  return { ...(gender && { gender }), ...(age && { age }) }
}

/**
 * The words of the keywords that asked for the library's gender and age (see `libraryFilters`),
 * split as `rankVoices` reads words: every voice found was asked for with them, so each has them,
 * though its own words may not say so.
 */
export function libraryWords(keywords: string[]): string[] {
  const words = keywordWords(keywords)
  const { gender, age } = libraryFilters(keywords)
  // A word counts only if everything it names was asked for ("boy" is male and young).
  const asked = words.filter(
    (w) =>
      (GENDERS[w] || AGES[w]) &&
      (!GENDERS[w] || GENDERS[w] === gender) &&
      (!AGES[w] || AGES[w] === age),
  )
  return [...new Set(asked.flatMap((w) => w.split('-')))]
}

/**
 * The voices the studio added to the user's ElevenLabs voices from the library
 * (`.audio-studio/eleven-voices.json`): each library voice, the voice it became on the account,
 * its name, and the character whose audition added it and when.
 */
export const ElevenVoicesSchema = z.object({
  version: z.literal(1),
  added: z
    .array(
      z.object({
        library: z.string(),
        voice: z.string(),
        name: z.string(),
        character: z.string(),
        at: z.string(),
      }),
    )
    .default([]),
})

/** The voices the studio added from ElevenLabs' library. */
export type ElevenVoices = z.infer<typeof ElevenVoicesSchema>

/** The voice on the account that a library voice became when the studio added it, or null. */
export function addedVoiceFor(file: ElevenVoices, library: string): string | null {
  return file.added.find((a) => a.library === library)?.voice ?? null
}
