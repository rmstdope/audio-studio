/**
 * A lock file as the studio read it: its entries by id, or that it could not be read. Every medium
 * (music, sound effects, images) carries its lock this way, so a page cannot claim something about
 * the game while the file that would say so is unreadable.
 */
export type LockRead<T> = { read: true; entries: Record<string, T> } | { read: false }

/** The lock that could not be read. */
export const LOCK_UNREAD: LockRead<never> = { read: false }

/** Where one id stands in a lock: chosen (with its entry), not chosen, or not known. */
export type LockStanding<T> =
  { standing: 'chosen'; entry: T } | { standing: 'not-chosen' } | { standing: 'unknown' }

/** Where `id` stands in `lock`: unknown when the lock could not be read, never "not chosen". */
export function lockEntry<T>(lock: LockRead<T>, id: string): LockStanding<T> {
  if (!lock.read) return { standing: 'unknown' }
  const entry = lock.entries[id]
  return entry === undefined ? { standing: 'not-chosen' } : { standing: 'chosen', entry }
}
