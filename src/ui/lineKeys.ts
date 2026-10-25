/** What a key does on a row of the lines table. */
export type LineKeyAction =
  | 'next'
  | 'previous'
  | 'play'
  | 'fromHere'
  | 'record'
  | 'accept'
  | 'heard'
  | 'cue'
  | 'note'
  | 'takes'

/** One action of the lines table: its keys, how the hint shows them, and what it does. */
export interface LineKey {
  keys: string[]
  shown: string
  does: string
  action: LineKeyAction
}

/** The keys of the lines table, in the order the hint shows them: one table for the hint and the handler. */
export const LINE_KEYS: LineKey[] = [
  { keys: ['j', 'ArrowDown'], shown: 'j ↓', does: 'next line', action: 'next' },
  { keys: ['k', 'ArrowUp'], shown: 'k ↑', does: 'previous line', action: 'previous' },
  { keys: [' ', 'Enter'], shown: 'space', does: 'play', action: 'play' },
  { keys: ['f'], shown: 'f', does: 'play from here', action: 'fromHere' },
  { keys: ['r'], shown: 'r', does: 'record or retake', action: 'record' },
  { keys: ['a'], shown: 'a', does: 'accept', action: 'accept' },
  { keys: ['h'], shown: 'h', does: 'what was heard', action: 'heard' },
  { keys: ['c'], shown: 'c', does: 'cue', action: 'cue' },
  { keys: ['n'], shown: 'n', does: 'note', action: 'note' },
  { keys: ['t'], shown: 't', does: 'takes', action: 'takes' },
]

/** Where a key was pressed, as far as the table cares. */
export interface KeyPress {
  key: string
  /** Cmd, Ctrl or Alt held: the browser's or the system's shortcut, never the table's. */
  modifier: boolean
  /** Pressed while typing in a field: the field's. */
  typing: boolean
  /** Pressed on a button in the row: space and Enter are the button's, the letters the row's. */
  onButton: boolean
}

/**
 * What a key pressed on a focused row does, or null for a key the table does not use: a key with a
 * modifier, one typed in a field, and space or Enter on a button (its own activation) are not the
 * table's.
 */
export function lineKeyAction({ key, modifier, typing, onButton }: KeyPress): LineKeyAction | null {
  if (modifier || typing) return null
  const found = LINE_KEYS.find((k) => k.keys.includes(key))
  if (!found) return null
  if (found.action === 'play' && onButton) return null
  return found.action
}

/** Whether a key pressed on `tagName` is typing in a field, not a command to the table. */
export function isTyping(tagName: string): boolean {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName.toUpperCase())
}
