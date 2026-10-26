import { z } from 'zod'
import { TakeInputsSchema, type TakeInputs } from './musicTake'
import type { TrackRow } from './music'

/** One track in the music lock: the take the game plays, and what it was made from. */
export const LockEntrySchema = z.object({
  /** A hash of what went into the take (brief, kind, seconds, bpm, key). */
  fp: z.string(),
  model: z.string(),
  seed: z.number(),
  /** Which list the track came from: an act's id, or `stingers`. */
  list: z.string(),
  /** The number of the take on the track's board. */
  take: z.number().int().positive(),
  /** The chosen take's own inputs, which the track's are compared with. */
  inputs: TakeInputsSchema,
  /** When it was chosen (ISO time). */
  at: z.string(),
})

/** `music.lock.json`: the chosen take of each track, by track id. */
export const MusicLockSchema = z.record(z.string(), LockEntrySchema)

/** `manifest.json` of the music clips folder, which the game reads: `{ track: { file, duration } }`. */
export const MusicManifestSchema = z.record(
  z.string(),
  z.object({ file: z.string(), duration: z.number() }),
)

/** A track's entry in the lock. */
export type LockEntry = z.infer<typeof LockEntrySchema>

/** The music lock. */
export type MusicLock = z.infer<typeof MusicLockSchema>

/** The music manifest. */
export type MusicManifest = z.infer<typeof MusicManifestSchema>

/** Where a track stands: no take chosen, the chosen one is current, changed since, or its file is gone. */
export type TrackStatus = 'not-chosen' | 'chosen' | 'changed' | 'missing'

/** What can have changed since a take was chosen. */
export type ChangedField = 'brief' | 'length' | 'tempo' | 'key'

/** What differs between the chosen take's own inputs and the track's now, in a fixed order. */
export function changedFields(lock: LockEntry, now: TakeInputs): ChangedField[] {
  const then = lock.inputs
  const changed: ChangedField[] = []
  if (then.brief !== now.brief) changed.push('brief')
  if (then.seconds !== now.seconds) changed.push('length')
  if (then.bpm !== now.bpm) changed.push('tempo')
  if (then.key !== now.key) changed.push('key')
  return changed
}

/** The status of a track from its lock entry, its inputs now and whether its music file is there. */
export function trackStatus({
  lock,
  current,
  fileExists,
}: {
  lock: LockEntry | undefined
  current: TakeInputs
  fileExists: boolean
}): TrackStatus {
  if (!lock) return 'not-chosen'
  // The file is the more urgent fact: the game has nothing to play.
  if (!fileExists) return 'missing'
  return changedFields(lock, current).length ? 'changed' : 'chosen'
}

const NAMES: Record<ChangedField, string> = {
  brief: 'the brief',
  length: 'the length',
  tempo: 'the tempo',
  key: 'the key',
}

/** The first line of the box saying what changed since the take was chosen. */
export function changedLine(fields: ChangedField[]): string {
  const names = fields.map((field) => NAMES[field])
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return `Changed since its take was chosen: ${list}.`
}

/** The words of a status chip. */
export const STATUS_LABEL: Record<TrackStatus, string> = {
  'not-chosen': 'not chosen',
  chosen: 'chosen',
  changed: 'changed since chosen',
  missing: 'music file missing',
}

/** How many of a list's tracks are chosen, and how many of those have lost their music file. */
export function chosenLine({
  chosen,
  total,
  missing,
}: {
  chosen: number
  total: number
  missing: number
}): string {
  const base = `${chosen} of ${total} chosen`
  if (!missing) return `${base}.`
  return missing === 1
    ? `${base}; one's music file is missing.`
    : `${base}; ${missing} music files are missing.`
}

/** What a track's "In the game" block shows. */
export type InTheGameState =
  | { kind: 'take'; take: number; missing: boolean; hint: string }
  | { kind: 'game'; file: string; exists: boolean; hint: string }
  | { kind: 'nothing'; hint: string }

/**
 * What the game plays for a track, singled out on its page: the chosen take (its music file gone
 * or not), else the game's own file (there or not), else nothing; each with the faint line saying
 * what comes next.
 */
export function inTheGame(track: Pick<TrackRow, 'current' | 'gameFile'>): InTheGameState {
  const { current, gameFile } = track
  if (current.kind === 'take') {
    return {
      kind: 'take',
      take: current.take,
      missing: !current.exists,
      hint: gameFile
        ? 'Un-choose and the game goes back to its own file.'
        : 'Un-choose and the game plays nothing here.',
    }
  }
  if (current.kind === 'game') {
    return {
      kind: 'game',
      file: current.file,
      exists: current.exists,
      hint: 'Choose a take below and the game plays it instead.',
    }
  }
  return { kind: 'nothing', hint: 'Choose a take below and the game plays it.' }
}

/** The question before un-choosing take `take`: where the game goes, and what is deleted. */
export function unchooseQuestion(take: number, gameFile: string | null): string {
  const goes = gameFile
    ? `The game goes back to its own file (${gameFile}).`
    : 'The game plays nothing here until another take is chosen.'
  return `${goes} Take ${take}'s music file is deleted from the game; Take ${take} stays with the other takes, to be chosen again.`
}

/** The red line when un-choosing failed. */
export function unchooseFailure(take: number, reason: string): string {
  const plain = reason.replace(/\.$/, '')
  const said = plain.charAt(0).toLowerCase() + plain.slice(1)
  return `Take ${take} could not be un-chosen: ${said}. Nothing was changed.`
}
