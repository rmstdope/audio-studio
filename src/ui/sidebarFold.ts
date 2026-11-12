import { useEffect, useState } from 'react'

/** The browser-storage key of whether the sidebar is folded to the rail. */
export const FOLDED_KEY = 'content-studio.sidebar-folded'

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem'>

/** The browser's local storage, or nothing where it is blocked. */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Whether the person left the sidebar folded; unfolded when the browser keeps nothing. */
export function readFolded(storage: Reader | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(FOLDED_KEY) === '1'
  } catch {
    return false
  }
}

/** Remembers whether the sidebar is folded, in the browser only; a refused write is ignored. */
export function writeFolded(folded: boolean, storage: Writer | undefined = browserStorage()): void {
  try {
    storage?.setItem(FOLDED_KEY, folded ? '1' : '0')
  } catch {
    // The choice just is not remembered.
  }
}

/** How far an act is, as its rail dot: all done, some, or none. */
export function railDot(done: number, total: number): 'all' | 'some' | 'none' {
  if (total > 0 && done === total) return 'all'
  return done > 0 ? 'some' : 'none'
}

/** The rail pill of the act at this position in the list ("Act 1" for the first). */
export function actPillLabel(index: number): string {
  return `Act ${index + 1}`
}

/** Whether keys typed at this element belong to a field, so the studio's shortcuts stay out. */
export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName ?? '')
}

/** Whether the sidebar is folded, with a toggle; the `[` key toggles it outside fields. */
export function useSidebarFolded(): [boolean, () => void] {
  const [folded, setFolded] = useState(() => readFolded())
  const toggle = () =>
    setFolded((was) => {
      writeFolded(!was)
      return !was
    })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // [ needs Option (Mac) or AltGr (Ctrl+Alt) on many layouts, so only Ctrl or Cmd alone is a shortcut.
      if (e.key !== '[' || e.repeat || e.metaKey || (e.ctrlKey && !e.altKey)) return
      if (isTypingTarget(e.target as Element | null)) return
      e.preventDefault()
      toggle()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return [folded, toggle]
}
