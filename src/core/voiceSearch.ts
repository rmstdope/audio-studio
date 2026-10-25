import { z } from 'zod'

/** A voice in Fish Audio's library, as the studio uses (and saves) it. */
export const VoiceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  languages: z.array(z.string()),
  /** How many times it has been used for generation: Fish's measure of popularity. */
  uses: z.number(),
  likes: z.number(),
  author: z.string(),
  /** The uploader's demo clip, if any. Free to play. */
  sample: z.object({ text: z.string(), audio: z.string() }).nullable(),
  /** Whether it is a voice on the user's own Fish account (cloned or private), not the library's. */
  own: z.boolean().optional(),
  /**
   * Set on a voice Fish designed from a description and that is not on the user's account yet:
   * its number for the character ("Design n"), the description it was made from, and when it was
   * asked for (ISO 8601; the designs of one request share it).
   */
  design: z.object({ n: z.number(), description: z.string(), at: z.string() }).optional(),
})

/** A voice in Fish Audio's library, as the studio uses it. */
export type Voice = z.infer<typeof VoiceSchema>

/** A voice found for an audition, with the keywords it matched. */
export interface Candidate {
  voice: Voice
  matched: string[]
}

/** A word: letters and digits, with apostrophes only inside it (`grandma's`, not `'wise'`). */
const WORD = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu

function words(text: string): string[] {
  return text.toLowerCase().replaceAll('’', "'").match(WORD) ?? []
}

/** Keywords in lower case, once each, without ones that have no words (they would match anything). */
function clean(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => k.trim().toLowerCase()))].filter((k) => words(k).length)
}

/** Whether a keyword has any word to match. */
export function hasWords(keyword: string): boolean {
  return words(keyword).length > 0
}

/**
 * What to search Fish for: each keyword, then each word in them, once. Fish's own title search
 * is loose and ranks by popularity, so a phrase alone rarely finds the voices that match it; the
 * results are pooled and ranked here (as RetroQuest's `fish_tts.py voices search` does).
 */
export function searchTerms(keywords: string[]): string[] {
  // A one-letter term would bring up most of the library and rank nothing.
  const phrases = clean(keywords).filter((phrase) => phrase.length > 1)
  const single = phrases.flatMap(words).filter((word) => word.length > 1)
  return [...new Set([...phrases, ...single])]
}

/**
 * The voices that match at least one keyword (every word of it, as whole words in the title,
 * description or tags), most keywords matched first, then most used. Voices in `exclude` (the
 * current voice, voices dropped earlier) and duplicates are left out.
 */
export function rankVoices(voices: Voice[], keywords: string[], exclude: Set<string>): Candidate[] {
  const phrases = clean(keywords)
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  for (const voice of voices) {
    if (seen.has(voice.id) || exclude.has(voice.id)) continue
    seen.add(voice.id)
    const text = new Set(words(`${voice.title} ${voice.description} ${voice.tags.join(' ')}`))
    const matched = phrases.filter((phrase) => words(phrase).every((word) => text.has(word)))
    if (matched.length) candidates.push({ voice, matched })
  }
  return candidates.sort(
    (a, b) =>
      b.matched.length - a.matched.length ||
      b.voice.uses - a.voice.uses ||
      a.voice.id.localeCompare(b.voice.id),
  )
}
