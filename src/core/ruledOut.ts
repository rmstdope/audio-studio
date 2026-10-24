import { z } from 'zod'

/**
 * The voices ruled out for one character: dropped in an audition, and left out of every later
 * search for it until allowed again. Each keeps its title, so a page can name it without asking
 * Fish, and when it was ruled out. Saved files are checked against this schema when read back.
 */
export const RuledOutSchema = z.object({
  version: z.literal(1),
  character: z.string(),
  voices: z.record(z.string(), z.object({ title: z.string(), at: z.string() })),
})

/** The voices ruled out for one character. */
export type RuledOut = z.infer<typeof RuledOutSchema>

/** A ruled-out voice, as a page lists it. */
export interface RuledOutVoice {
  id: string
  title: string
  /** When it was ruled out (ISO 8601). */
  at: string
}

/** No voice ruled out for the character yet. */
export function emptyRuledOut(character: string): RuledOut {
  return { version: 1, character, voices: {} }
}

/** The voices, the latest ruled out first (then by id, so the order is stable). */
export function listRuledOut(ruled: RuledOut): RuledOutVoice[] {
  return Object.entries(ruled.voices)
    .map(([id, { title, at }]) => ({ id, title, at }))
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? 1 : -1))
}

/** With `voices` ruled out at `at`; a voice already ruled out keeps when it first was. */
export function ruleOut(
  ruled: RuledOut,
  voices: { id: string; title: string }[],
  at: string,
): RuledOut {
  const next = { ...ruled.voices }
  for (const { id, title } of voices) next[id] ??= { title, at }
  return { ...ruled, voices: next }
}

/** With `ids` allowed again: no longer ruled out. */
export function allowAgain(ruled: RuledOut, ids: string[]): RuledOut {
  const next = { ...ruled.voices }
  for (const id of ids) delete next[id]
  return { ...ruled, voices: next }
}
