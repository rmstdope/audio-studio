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
  for (const [written, sayAs] of Object.entries(pronounce)) said = said.replaceAll(written, sayAs)
  return said
}

/**
 * A line split at sentence ends into pieces of at most `limit` characters where possible. A
 * sentence longer than `limit` stays whole. (Ported from `narrate.py`, `chunk_text`.)
 */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const last = chunks.at(-1)
    if (last !== undefined && last.length + 1 + sentence.length <= limit) {
      chunks[chunks.length - 1] = `${last} ${sentence}`
    } else {
      chunks.push(sentence)
    }
  }
  return chunks
}
