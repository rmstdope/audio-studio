/** A pronunciation: the words as written, and how they are said. */
export type Pronunciation = [written: string, said: string]

/** Keys JavaScript would move to the front of an object, changing the order they apply in. */
export const INTEGER_LIKE = /^(0|[1-9]\d*)$/

/** A table as typed: both sides trimmed, rows left empty dropped. */
export function cleanPronunciations(table: Pronunciation[]): Pronunciation[] {
  return table
    .map(([written, said]): Pronunciation => [written.trim(), said.trim()])
    .filter(([written, said]) => written || said)
}

/**
 * Why a pronunciation table cannot be saved, or null: every entry needs the words it replaces
 * and how they are said, each written form once, and no number-like written form among others
 * (JavaScript would apply it first, where the file lists it later).
 */
export function pronounceProblem(table: Pronunciation[]): string | null {
  const seen = new Set<string>()
  for (const [written, said] of table) {
    if (!written) return `a pronunciation of “${said}” needs the words it replaces`
    if (!said) return `“${written}” needs how it is said`
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

/** Whether two tables have the same entries in the same order. */
export function sameTable(a: Pronunciation[], b: Pronunciation[]): boolean {
  return a.length === b.length && a.every(([w, s], i) => w === b[i]![0] && s === b[i]![1])
}
