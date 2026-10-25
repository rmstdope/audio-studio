import { useSyncExternalStore } from 'react'
import type { Take } from '../core/retirement'

let switched: Take[] = []
const listeners = new Set<() => void>()

function emit(next: Take[]) {
  switched = next
  for (const listener of listeners) listener()
}

/** The takes that left s1 through the Models panel since the confirmation was last dismissed, draft first. */
export function switchedTakes(): Take[] {
  return switched
}

/** Notes that `take` was switched from s1 to s2.1-pro in the Models panel, for the banner's confirmation. */
export function markSwitched(take: Take): void {
  if (switched.includes(take)) return
  emit((['draft', 'final'] as const).filter((t) => t === take || switched.includes(t)))
}

/** Forgets the switched takes: the confirmation was dismissed. */
export function clearSwitched(): void {
  if (switched.length > 0) emit([])
}

/** The switched takes, for a component that shows the banner's confirmation. */
export function useSwitchedTakes(): Take[] {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, switchedTakes)
}
