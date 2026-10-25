import { z } from 'zod'

/**
 * One of a line's extra takes, as kept in the tool cache beside its WAV: when and from what it was
 * made, and what Whisper made of it. Saved files are checked against this schema when read back.
 */
export const LineTakeSchema = z.object({
  version: z.literal(1),
  /** The take's id: the name of its two files. */
  id: z.string().regex(/^[0-9a-f]{16}$/),
  at: z.string(),
  /** The fingerprint of the line's inputs when the take was made; another now makes it stale. */
  fp: z.string(),
  model: z.string(),
  seconds: z.number().nonnegative(),
  /** The share of words heard, or null for a take not checked. */
  heard: z.number().min(0).max(1).nullable(),
  timed: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })),
  words: z.array(z.string()),
  missed: z.array(z.number().int().min(0)),
})

/** One of a line's extra takes, as kept. */
export type LineTake = z.infer<typeof LineTakeSchema>

/** A take as the lines page lists it. */
export interface LineTakeView {
  id: string
  at: string
  seconds: number
  heard: number | null
  /** Made from the line's inputs as they are now; a stale take can be heard but not used. */
  current: boolean
}

/** The takes as listed: newest first, each marked current when made from today's inputs (`fp`). */
export function takesView(takes: LineTake[], fp: string): LineTakeView[] {
  return [...takes]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ id, at, seconds, heard, fp: made }) => ({
      id,
      at,
      seconds,
      heard,
      current: made === fp,
    }))
}
