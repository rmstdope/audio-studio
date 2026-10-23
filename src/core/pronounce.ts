/** A pronunciation: the words as written, and how they are said. */
export type Pronunciation = [written: string, said: string]

/** Keys JavaScript would move to the front of an object, changing the order they apply in. */
export const INTEGER_LIKE = /^(0|[1-9]\d*)$/

/**
 * A table as typed, with rows left empty dropped. Nothing is trimmed: entries are matched as plain
 * text, so spaces are what anchor one to whole words (`"Al "` is not in "Alice").
 */
export function cleanPronunciations(table: Pronunciation[]): Pronunciation[] {
  return table.filter(([written, said]) => written || said)
}

/**
 * Why a pronunciation table cannot be saved, or null: every entry needs the words it replaces (an
 * empty said form leaves them out, as narrate.py does) and not only spaces, each written form once, no
 * `__proto__` (JavaScript cannot keep it as a key), and no number-like written form among
 * others (JavaScript would apply it first, where the file lists it later).
 */
export function pronounceProblem(table: Pronunciation[]): string | null {
  const seen = new Set<string>()
  for (const [written, said] of table) {
    if (!written) return `a pronunciation of “${said}” needs the words it replaces`
    if (!written.trim()) return 'a pronunciation of only spaces would change every line'
    if (written === '__proto__') return '“__proto__” cannot be a pronunciation in JavaScript'
    if (seen.has(written)) return `“${written}” twice in the table`
    seen.add(written)
  }
  const numbers = table.map(([written]) => written).filter((w) => INTEGER_LIKE.test(w))
  if (numbers.length && table.length > 1) {
    return (
      `${numbers.map((n) => `“${n}”`).join(', ')} would be applied before the others, as ` +
      'JavaScript puts number keys first. Make it longer, e.g. “Act 10” or “10 ”.'
    )
  }
  return null
}

/** A note on spaces at either end of a written or said form, which are easy to miss. */
export function spaceNote(text: string): string | null {
  const starts = text.startsWith(' ')
  const ends = text.endsWith(' ')
  if (starts && ends) return 'starts and ends with a space'
  if (starts) return 'starts with a space'
  if (ends) return 'ends with a space'
  return null
}

/** Whether two tables have the same entries in the same order. */
export function sameTable(a: Pronunciation[], b: Pronunciation[]): boolean {
  return a.length === b.length && a.every(([w, s], i) => w === b[i]![0] && s === b[i]![1])
}
