/**
 * Delivery cues placed inside a line's text. A line's entry in the cues file is its opening cue
 * alone (as it always was), or the cued text: the opening cue, then the line's own words with a
 * bracketed cue between some of them. No Node built-ins: the page uses it too.
 */

/** A cue placed in a gap: `at` words come before it, so it takes effect from word number `at`. */
export interface InsideCue {
  at: number
  cue: string
}

/** What a cues-file entry says about a line. */
export interface ParsedCue {
  /** The opening cue; empty when the entry has none. */
  opening: string
  /** The cues inside the line's words, in word order; empty when none, or when they do not fit. */
  inside: InsideCue[]
  /** The whole entry when it carries cues but its words are not the line's words; else null. */
  stale: string | null
}

const GROUP = /\[[^\]]*\]/g
const LEADING_GROUPS = /^(?:\s*\[[^\]]*\])*/

/** The words of a line: its whitespace-separated pieces. */
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** A cue as saved: trimmed, in brackets (added when missing); empty stays empty. */
export function normalizeCue(raw: string): string {
  const cue = raw.trim()
  if (!cue) return ''
  return cue.startsWith('[') && cue.endsWith(']') ? cue : `[${cue}]`
}

/**
 * Reads a cues-file entry against the line's words. An entry is cued only when a bracket group
 * follows a word (a cue is never before the first word, nor after the last), so an entry like
 * `[sad] very slowly` stays an opening cue. A cued entry whose words, cues removed, are not the
 * line's words (or whose cue is after the last word) gives no inside cues and is `stale`.
 */
export function parseCued(entry: string, text: string): ParsedCue {
  const leading = LEADING_GROUPS.exec(entry)![0]
  if (!entry.slice(leading.length).includes('[')) {
    return { opening: entry.trim(), inside: [], stale: null }
  }
  const words = wordsOf(text).join(' ')
  const starts = [...entry.matchAll(/(?<=^|\s)[^\s[]/g)].map((m) => m.index)
  for (const start of starts.reverse()) {
    const body = entry.slice(start)
    if (body.replace(GROUP, ' ').split(/\s+/).filter(Boolean).join(' ') !== words) continue
    const inside = insideOf(body)
    if (inside) return { opening: entry.slice(0, start).trim(), inside, stale: null }
  }
  return { opening: leading.trim(), inside: [], stale: entry }
}

/** The cues in cued words, or null for one after the last word. Cues of one gap are one cue. */
function insideOf(body: string): InsideCue[] | null {
  const inside: InsideCue[] = []
  let count = 0
  let pending = ''
  for (const part of body.split(/(\[[^\]]*\])|\s+/).filter((p) => p !== undefined && p !== '')) {
    if (part.startsWith('[') && part.endsWith(']')) {
      pending = pending ? `${pending} ${part}` : part
    } else {
      if (pending) inside.push({ at: count, cue: pending })
      pending = ''
      count++
    }
  }
  return pending ? null : inside
}

/** The entry to save: the opening cue, then the words with each inside cue before its word. */
export function composeCued(opening: string, inside: InsideCue[], text: string): string {
  if (!inside.length) return opening.trim()
  const words = wordsOf(text)
  const body = words.flatMap((word, i) => {
    const cue = inside.find((c) => c.at === i)
    return cue ? [cue.cue, word] : [word]
  })
  return [opening.trim(), ...body].filter(Boolean).join(' ')
}

/** `inside` with the cue at gap `at` set; an empty cue removes it. In word order. */
export function withInside(inside: InsideCue[], at: number, cue: string): InsideCue[] {
  const rest = inside.filter((c) => c.at !== at)
  return (cue ? [...rest, { at, cue }] : rest).sort((a, b) => a.at - b.at)
}

/** One piece of a long line as it is recorded. */
export interface CuedPiece {
  /** The cue in effect where the piece starts. */
  cue: string
  /** The piece's own text. */
  text: string
  /** Its inside cues; `at` counts from the piece's first word. */
  inside: InsideCue[]
}

/**
 * The pieces a line is recorded in (`chunks`, its text split as recording splits it), each with
 * the cue in effect at its start: the last cue at or before it, else the opening cue.
 */
export function piecesOf(chunks: string[], opening: string, inside: InsideCue[]): CuedPiece[] {
  let start = 0
  return chunks.map((text) => {
    const count = wordsOf(text).length
    const first = start
    start += count
    const before = inside.filter((c) => c.at <= first)
    return {
      cue: before.at(-1)?.cue ?? opening,
      text,
      inside: inside
        .filter((c) => c.at > first && c.at < first + count)
        .map((c) => ({ at: c.at - first, cue: c.cue })),
    }
  })
}

/** A part's cues as a language is spoken with them, and the source's, as openings only. */
export interface MergedCues {
  /** The cues the language is recorded with: the source's opening cues under its own entries. */
  cues: Record<string, string>
  /** The source's opening cues; its cues inside are never carried over. */
  sourceCues: Record<string, string>
}

/**
 * The cues a language besides the source follows: the source line's opening cue (read against the
 * source's words) for a line until the language's own entry gives one; an own entry with cues
 * inside and no opening rides on the source's opening cue. Own entries are otherwise as written.
 */
export function mergeCues(
  lines: { key: string; text: string }[],
  own: Record<string, string>,
  source: Record<string, string>,
  sourceLines: { key: string; text: string }[],
): MergedCues {
  const textOf = (all: { key: string; text: string }[], key: string) =>
    all.find((l) => l.key === key)?.text ?? ''
  const sourceCues: Record<string, string> = {}
  for (const [key, entry] of Object.entries(source)) {
    const line = sourceLines.find((l) => l.key === key)
    const opening = line ? parseCued(entry, line.text).opening : entry
    if (opening) sourceCues[key] = opening
  }
  const cues: Record<string, string> = { ...sourceCues }
  for (const [key, entry] of Object.entries(own)) {
    const lead = Object.hasOwn(sourceCues, key) ? sourceCues[key]! : ''
    const opening = parseCued(entry, textOf(lines, key)).opening
    cues[key] = lead && !opening ? `${lead} ${entry}` : entry
  }
  return { cues, sourceCues }
}
