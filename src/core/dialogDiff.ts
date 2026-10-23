import type { Line } from './resources'

/** What changed in a part's dialog, by line key, each list in dialog order. */
export interface DialogDiff {
  /** Keys new in the dialog (a reworded line gets a new key, so it shows here and in `removed`). */
  added: string[]
  removed: string[]
  /** Keys kept whose speaker or text changed. */
  changed: string[]
}

/** The difference between a part's dialog before and after it was refreshed. */
export function dialogDiff(before: Line[], after: Line[]): DialogDiff {
  const old = new Map(before.map((line) => [line.key, line]))
  const now = new Set(after.map((line) => line.key))
  return {
    added: after.filter((line) => !old.has(line.key)).map((line) => line.key),
    removed: before.filter((line) => !now.has(line.key)).map((line) => line.key),
    changed: after
      .filter((line) => {
        const was = old.get(line.key)
        return was !== undefined && (was.speaker !== line.speaker || was.text !== line.text)
      })
      .map((line) => line.key),
  }
}
