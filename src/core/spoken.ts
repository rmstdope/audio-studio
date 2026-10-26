import { piecesOf, wordsOf, type InsideCue } from './cued'

/**
 * The text sent to Fish for a line: the delivery cue, then the line with words said as the cast
 * asks. A quest card's checklist bullets are read as a list, not as "asterisk".
 * (Ported from RetroQuest's `narrate.py`, `spoken_text`.)
 */
export function spokenText(text: string, cue: string, pronounce: Record<string, string>): string {
  return `${cue} ${saidText(text, pronounce)}`.trim()
}

/** The line as it is said: checklist bullets read as a list, and the cast's pronunciations applied. */
export function saidText(text: string, pronounce: Record<string, string>): string {
  let said = text.replace(/:\s*\*\s+/g, ': ').replace(/\s+\*\s+/g, ', ')
  // split/join, not replaceAll: a `$` in the replacement must stay literal, as in Python.
  for (const [written, sayAs] of Object.entries(pronounce)) said = said.split(written).join(sayAs)
  return said
}

/**
 * A line split at sentence ends into pieces of at most `limit` characters where possible. A
 * sentence longer than `limit` stays whole. (Ported from `narrate.py`, `chunk_text`.)
 */
export function chunkText(text: string, limit: number): string[] {
  if (length(text) <= limit) return [text]
  const chunks: string[] = []
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const last = chunks.at(-1)
    if (last !== undefined && length(last) + 1 + length(sentence) <= limit) {
      chunks[chunks.length - 1] = `${last} ${sentence}`
    } else {
      chunks.push(sentence)
    }
  }
  return chunks
}

/** Length in characters (code points), as Python's `len` counts, not UTF-16 units. */
function length(text: string): number {
  return [...text].length
}

/**
 * What Fish is sent for a line: each sentence-sized piece, with the cue and the cast's
 * pronunciations (as narrate.py `_take` does). Used both to record and to price a plan, so the
 * two never drift apart. With cues placed inside the line, each piece starts with the cue in
 * effect at its start and carries its own inside cues where they were placed.
 */
export function spokenPieces(
  text: string,
  cue: string,
  pronounce: Record<string, string>,
  chunkLimit: number,
  inside: InsideCue[] = [],
): string[] {
  const chunks = chunkText(text, chunkLimit)
  if (!inside.length) return chunks.map((chunk) => spokenText(chunk, cue, pronounce))
  return piecesOf(chunks, cue, inside).map((piece) => {
    const words = wordsOf(piece.text)
    const parts: string[] = []
    let from = 0
    for (const at of [...piece.inside.map((c) => c.at), words.length]) {
      const said = saidText(words.slice(from, at).join(' '), pronounce)
      const placed = piece.inside.find((c) => c.at === from)
      parts.push(...(placed ? [placed.cue] : []), said)
      from = at
    }
    return [piece.cue, ...parts].filter(Boolean).join(' ')
  })
}
