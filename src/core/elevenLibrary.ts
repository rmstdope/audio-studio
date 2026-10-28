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
  aged: 'old',
}

/**
 * The gender and age to search ElevenLabs' library for, from the keywords: each only when the
 * keywords name exactly one (as whole words: "human" names no man).
 */
export function libraryFilters(keywords: string[]): LibraryFilters {
  const words = keywords.flatMap((k) => k.toLowerCase().match(/[\p{L}-]+/gu) ?? [])
  const one = <T>(table: Record<string, T>): T | undefined => {
    const named = new Set(words.flatMap((w) => (table[w] ? [table[w]] : [])))
    return named.size === 1 ? [...named][0] : undefined
  }
  const gender = one(GENDERS)
  const age = one(AGES)
  return { ...(gender && { gender }), ...(age && { age }) }
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
