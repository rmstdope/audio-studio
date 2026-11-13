import { useRef, useState } from 'react'

/** The way to see a field's words saved: a save under way, or null when there is nothing to save. */
export type SaveFirst = () => Promise<boolean> | null

/**
 * The wait every Make button has for unsaved words: takes are made from the saved words, so `afterSaved`
 * saves them first and only then runs `ask`, never when the save failed. `waiting` is true while the
 * save runs, for the button to say why it is off.
 */
export function useAfterSaved(save: SaveFirst | undefined): {
  waiting: boolean
  afterSaved: (ask: () => void) => void
} {
  const [waiting, setWaiting] = useState(false)
  const afterSaved = (ask: () => void) => {
    const saving = save?.() ?? null
    if (saving === null) return ask()
    setWaiting(true)
    void saving.then((saved) => {
      setWaiting(false)
      if (saved) ask()
    })
  }
  return { waiting, afterSaved }
}

/**
 * The save a field has under way, kept for the Make button to wait on. `track` records a save the
 * moment it starts (a press that left the field comes before any render) and forgets it when it
 * settles; `current` is the save under way, or null.
 */
export function useLatestSave(): {
  track: (saved: Promise<boolean>) => Promise<boolean>
  current: () => Promise<boolean> | null
} {
  const saving = useRef<Promise<boolean> | null>(null)
  return useRef({
    track: (saved: Promise<boolean>) => {
      saving.current = saved
      void saved.then(() => {
        if (saving.current === saved) saving.current = null
      })
      return saved
    },
    current: () => saving.current,
  }).current
}
