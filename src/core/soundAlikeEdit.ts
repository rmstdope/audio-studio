/** A sound-alike word the project may list: one word, no spaces, with a letter or digit in it. */
export const SOUND_ALIKE_WORD = /^\S*[\p{L}\p{N}]\S*$/u

/** The groups written in rows, one group a row, words split at commas; empty ones dropped. */
export function groupsFrom(rows: string[]): string[][] {
  return cleanGroups(rows.map((row) => row.split(',')))
}

/** The groups with their words trimmed, and empty words and groups dropped. */
export function cleanGroups(groups: string[][]): string[][] {
  return groups
    .map((group) => group.map((word) => word.trim()).filter(Boolean))
    .filter((group) => group.length > 0)
}

/** The groups as rows to edit: one a row, words joined by commas. */
export function rowsFrom(groups: string[][]): string[] {
  return groups.map((group) => group.join(', '))
}

/** What is wrong with the groups, said for the page, or null: each needs two words or more. */
export function groupsProblem(groups: string[][]): string | null {
  for (const [i, group] of groups.entries()) {
    if (group.length < 2) {
      return `Group ${i + 1} has one word: add another that sounds the same, or remove it.`
    }
    const odd = group.find((word) => !SOUND_ALIKE_WORD.test(word))
    if (odd !== undefined) {
      return `Group ${i + 1}: “${odd}” is not one word (no spaces, some letters).`
    }
  }
  return null
}

/** Whether two lists of groups are the same, word for word and in order. */
export function sameGroups(a: string[][], b: string[][]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
