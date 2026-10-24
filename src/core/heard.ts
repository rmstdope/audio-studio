import { z } from 'zod'

/** What Whisper heard of a line's kept take: its words, and which shown words it missed. */
export const HeardLineSchema = z.object({
  /** The lock entry's time of the take, so a later take's clip is never shown with it. */
  at: z.string(),
  /** The line's text the take was checked against: the text may change before it is retaken. */
  text: z.string(),
  /** Whisper's words, as it wrote them. */
  words: z.array(z.string()),
  /** The indices of the shown words (`text` split on spaces) that were not heard. */
  missed: z.array(z.number().int().min(0)),
})

/** What Whisper heard of a line's kept take. */
export type HeardLine = z.infer<typeof HeardLineSchema>

/**
 * What Whisper heard of one part's lines, kept for those not heard in full, so the page can show
 * what was heard beside the text. Saved files are checked against this schema when read back.
 */
export const HeardSchema = z.object({
  version: z.literal(1),
  part: z.string(),
  lines: z.record(z.string(), HeardLineSchema),
})

/** What Whisper heard of one part's lines. */
export type Heard = z.infer<typeof HeardSchema>

/** Nothing kept for the part yet. */
export function emptyHeard(part: string): Heard {
  return { version: 1, part, lines: {} }
}

/**
 * With `line` kept for `key`, replacing what was kept before; null forgets it (a take heard in
 * full). Unchanged, the same object, when there was nothing to forget.
 */
export function withHeard(heard: Heard, key: string, line: HeardLine | null): Heard {
  if (line) return { ...heard, lines: { ...heard.lines, [key]: line } }
  if (!Object.hasOwn(heard.lines, key)) return heard
  const { [key]: _gone, ...lines } = heard.lines
  return { ...heard, lines }
}
