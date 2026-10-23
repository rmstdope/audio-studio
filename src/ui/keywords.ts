import { hasWords } from '../core/voiceSearch'

/**
 * The keyword list with `draft` added, or null when there is nothing to add: it is empty, has no
 * words, or is already there in another case. The same rules the server applies when saving.
 */
export function addKeyword(keywords: string[], draft: string): string[] | null {
  const word = draft.trim()
  if (!hasWords(word)) return null
  if (keywords.some((k) => k.toLowerCase() === word.toLowerCase())) return null
  return [...keywords, word]
}
