/**
 * A sound-alike word or phrase the project may list ("Lyria", "all right"): words parted by one
 * space, each with a letter or digit in it, and no commas (which part the words of a row).
 */
export const SOUND_ALIKE_WORD = /^[^\s,]*[\p{L}\p{N}][^\s,]*(?: [^\s,]*[\p{L}\p{N}][^\s,]*)*$/u

/** The groups written in rows, one group a row, words split at commas; empty ones dropped. */
export function groupsFrom(rows: string[]): string[][] {
  return cleanGroups(rows.map((row) => row.split(',')))
}

/** The groups with their words trimmed, spaces inside as one, and empty words and groups dropped. */
export function cleanGroups(groups: string[][]): string[][] {
  return groups
    .map((group) => group.map((word) => word.trim().replace(/\s+/g, ' ')).filter(Boolean))
    .filter((group) => group.length > 0)
}

/** The groups as rows to edit: one a row, words joined by commas. */
export function rowsFrom(groups: string[][]): string[] {
  return groups.map((group) => group.join(', '))
}

/**
 * What is wrong with the groups, said for the page by their words, or null: each needs two words
 * or more, each a word that can match.
 */
export function groupsProblem(groups: string[][]): string | null {
  for (const group of groups) {
    if (group.length < 2) {
      return `“${group[0]}” is alone in its group: add another word that sounds the same, or remove it.`
    }
    const odd = group.find((word) => !SOUND_ALIKE_WORD.test(word))
    if (odd !== undefined) {
      return `“${odd}” is not a word or phrase (no commas, some letters in each word).`
    }
  }
  return null
}

/** Whether two lists of groups are the same, word for word and in order. */
export function sameGroups(a: string[][], b: string[][]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
