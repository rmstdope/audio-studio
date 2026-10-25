/** What a key does on a row of the lines table. */
export type LineKeyAction =
  'next' | 'previous' | 'play' | 'fromHere' | 'record' | 'accept' | 'heard' | 'cue' | 'note'

/** The keys of the lines table, with what each does, in the order the hint shows them. */
export const LINE_KEYS: { keys: string; does: string }[] = [
  { keys: 'j k', does: 'move' },
  { keys: 'space', does: 'play' },
  { keys: 'f', does: 'play from here' },
  { keys: 'r', does: 'record or retake' },
  { keys: 'a', does: 'accept' },
  { keys: 'h', does: 'what was heard' },
  { keys: 'c', does: 'cue' },
  { keys: 'n', does: 'note' },
]

/**
 * What a key pressed on a focused row does, or null for a key the table does not use. Arrows and
 * j/k move, space and Enter play. While typing in a field (`typing`) no key is the table's.
 */
export function lineKeyAction(key: string, typing: boolean): LineKeyAction | null {
  if (typing) return null
  switch (key) {
    case 'j':
    case 'ArrowDown':
      return 'next'
    case 'k':
    case 'ArrowUp':
      return 'previous'
    case ' ':
    case 'Enter':
      return 'play'
    case 'f':
      return 'fromHere'
    case 'r':
      return 'record'
    case 'a':
      return 'accept'
    case 'h':
      return 'heard'
    case 'c':
      return 'cue'
    case 'n':
      return 'note'
    default:
      return null
  }
}

/** Whether a key pressed on `tagName` is typing in a field, not a command to the table. */
export function isTyping(tagName: string): boolean {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName.toUpperCase())
}
