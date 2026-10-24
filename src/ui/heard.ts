/** The shown words of a line (split on spaces, as aligned), each saying whether Whisper missed it. */
export function markMissed(text: string, missed: number[]): { word: string; missed: boolean }[] {
  const out = new Set(missed)
  return text.split(' ').map((word, i) => ({ word, missed: out.has(i) }))
}
