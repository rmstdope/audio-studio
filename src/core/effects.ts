import { z } from 'zod'
import {
  effectChangedFields,
  effectStatus,
  type EffectChangedField,
  type EffectCurrent,
  type EffectLockEntry,
  type EffectStatus,
} from './effectTakes'
import { problemsFrom, type Problem } from './project'

/**
 * A sound effect as the game lists it. The id names the effect everywhere, so it is a slug. Its
 * words are `text` in the list; the studio calls them the effect's description.
 */
export const EffectEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lower-case letters, digits and - only'),
    /** What the studio calls the effect; absent, a name is made from the id. */
    title: z.string().min(1).optional(),
    /** What the effect sounds like, in the game's words. */
    text: z.string().min(1),
    /** How long the effect is, in seconds; set by the game. */
    seconds: z.number().positive(),
    /** The effect plays round and round (ambience); absent: it plays once. */
    loops: z.boolean().optional(),
  })
  .transform(({ text, ...rest }): EffectEntry => ({ ...rest, description: text }))

/** A sound effect of the game's list, its words as its description. */
export interface EffectEntry {
  id: string
  title?: string
  description: string
  seconds: number
  loops?: boolean
}

/** A rewording: the studio's own words for an effect (`text`), with the game's words they were written over. */
const OwnWords = z.object({ text: z.string().min(1), gameWas: z.string() })

/** `content-studio/effects/edits.json`: the studio's own descriptions, by effect id. */
export const EffectOverridesSchema = z.record(z.string(), OwnWords)

/** The studio's own descriptions, by effect id. */
export type EffectOverrides = z.infer<typeof EffectOverridesSchema>

/** What reading the game's effects list gave. */
export type EffectsRead =
  | {
      ok: true
      /** The entries that can be used, in the game's order. */
      effects: EffectEntry[]
      problems: Problem[]
      /** How many entries were left out for a problem. */
      unreadable: number
      /** Every id the list mentions, readable or not. */
      seenIds: Set<string>
    }
  | { ok: false; problems: Problem[] }

/**
 * The entries of the game's effects list, one by one: an entry with a problem is left out and
 * reported with its place (`[2].seconds`) in `file`, and an id used twice leaves out both entries.
 * A file that is not a list is unreadable as a whole.
 */
export function readEffectEntries(json: unknown, file: string): EffectsRead {
  if (!Array.isArray(json)) {
    return {
      ok: false,
      problems: [{ file, path: '', message: 'expected a list of effects' }],
    }
  }
  const problems: Problem[] = []
  const seenIds = new Set<string>()
  const valid: { index: number; entry: EffectEntry }[] = []
  json.forEach((item: unknown, index) => {
    const id = (item as { id?: unknown } | null)?.id
    if (typeof id === 'string') seenIds.add(id)
    const parsed = EffectEntrySchema.safeParse(item)
    if (parsed.success) return void valid.push({ index, entry: parsed.data })
    for (const problem of problemsFrom(file, parsed.error)) {
      const path = problem.path ? `[${index}].${problem.path}` : `[${index}]`
      problems.push({ ...problem, path })
    }
  })
  // An id is used twice however its other copy fares: a copy with a problem counts too.
  const counts = new Map<string, number>()
  json.forEach((item: unknown) => {
    const id = (item as { id?: unknown } | null)?.id
    if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1)
  })
  const twice = valid.filter(({ entry }) => counts.get(entry.id)! > 1)
  for (const { index, entry } of twice) {
    problems.push({ file, path: `[${index}].id`, message: `"${entry.id}" is used twice` })
  }
  const effects = valid.filter(({ entry }) => counts.get(entry.id) === 1).map((v) => v.entry)
  problems.sort((a, b) => entryIndex(a.path) - entryIndex(b.path))
  return { ok: true, effects, problems, unreadable: json.length - effects.length, seenIds }
}

/** The entry number a problem's path starts with. */
function entryIndex(path: string): number {
  return Number(/^\[(\d+)\]/.exec(path)?.[1] ?? -1)
}

/** A readable name made from an id: "door-creak" is "Door creak". */
export function effectName(id: string): string {
  const spaced = id.replaceAll('-', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** A length as the page writes it: "3 s", "0.5 s". */
export function effectSeconds(seconds: number): string {
  return `${seconds} s`
}

/**
 * The studio's descriptions with an effect's set to `text`. Nothing, an empty text or the game's
 * own words take the effect back to the game's, dropping the studio's; else the words are kept
 * with the game's words they are written over.
 */
export function applyDescription(
  overrides: EffectOverrides,
  id: string,
  text: string | null,
  gameWords: string,
): EffectOverrides {
  const { [id]: _dropped, ...rest } = overrides
  const words = text?.trim() ?? ''
  if (words === '' || words === gameWords) return rest
  return { ...rest, [id]: { text: words, gameWas: gameWords } }
}

/** The studio's descriptions after "Keep mine": yours stay, and the game's present words are the ones they are over. */
export function keepMine(
  overrides: EffectOverrides,
  id: string,
  gameWords: string,
): EffectOverrides {
  const own = overrides[id]
  return own ? { ...overrides, [id]: { ...own, gameWas: gameWords } } : overrides
}

/** The ids a refresh added to the list and removed from it. */
export function effectsDiff(
  before: EffectEntry[],
  after: EffectEntry[],
): { added: string[]; removed: string[] } {
  const had = new Set(before.map((e) => e.id))
  const has = new Set(after.map((e) => e.id))
  return {
    added: after.filter((e) => !had.has(e.id)).map((e) => e.id),
    removed: before.filter((e) => !has.has(e.id)).map((e) => e.id),
  }
}

/** What reading the list gave, for the summary. */
export type EffectsListState =
  | { status: 'missing' }
  | { status: 'invalid'; problems: Problem[] }
  | {
      status: 'ok'
      effects: EffectEntry[]
      problems: Problem[]
      unreadable: number
      seenIds: Set<string>
    }

/** An effect as the Sound effects list shows it. */
export interface EffectRow {
  id: string
  name: string
  /** The description in use: the studio's, else the game's. */
  description: string
  /** What the game's list says. */
  gameDescription: string
  seconds: number
  /** The game plays it round and round. */
  loops: boolean
  /** The studio's own words are in use. */
  changedHere: boolean
  /** The game reworded the effect since the studio's words were written or last kept. */
  gameChanged: boolean
  /** Where the effect stands: no take yet, not chosen, chosen, changed since, its clip missing, or not known. */
  status: EffectStatus
  /** What the game plays for it now. */
  current: EffectCurrent
  /** What differs from the chosen take's inputs (empty when none is chosen). */
  changed: EffectChangedField[]
  /** A take is chosen, an out-of-date one included (not while the lock cannot be read). */
  chosen: boolean
}

/** What the studio knows of the effects' takes, read from the lock, the clips folder and the boards. */
export interface EffectsState {
  /** The lock's entries with whether each clip is a plain file there; null while the lock cannot be read. */
  chosen: Record<string, { lock: EffectLockEntry; fileExists: boolean }> | null
  /** The effects that have a take on their board. */
  takesMade: ReadonlySet<string>
}

/** Nothing chosen, made or being made. */
const NO_STATE: EffectsState = { chosen: {}, takesMade: new Set() }

/** An effect the game no longer lists, whose description the studio still keeps. */
export interface DroppedEffect {
  id: string
  name: string
  words: string
}

/** The Sound effects pages. */
export interface EffectsSummary {
  status: 'ok' | 'missing' | 'invalid'
  /** Whether the project names a command that refreshes the list. */
  canRefresh: boolean
  rows: EffectRow[]
  dropped: DroppedEffect[]
  /** How many entries of the list could not be read. */
  unreadable: number
  problems: Problem[]
  /** How many effects are up to date, out of all readable ones, and which need attention. */
  done: { done: number; total: number; needs: string[] }
}

/** The Sound effects pages from the list and the studio's own descriptions. */
export function summarizeEffects(input: {
  list: EffectsListState
  overrides: EffectOverrides
  canRefresh: boolean
  state?: EffectsState
}): EffectsSummary {
  const { list, overrides, canRefresh, state = NO_STATE } = input
  // Entries, and none of them readable: as unreadable as a list that is not one.
  if (list.status === 'ok' && list.effects.length === 0 && list.unreadable > 0) {
    return summarizeEffects({
      list: { status: 'invalid', problems: list.problems },
      overrides,
      canRefresh,
      state,
    })
  }
  const none = { rows: [], dropped: [], unreadable: 0, problems: [] as Problem[] }
  const done = (ids: string[]) => ({ done: 0, total: ids.length, needs: ids })
  if (list.status !== 'ok') {
    return {
      ...none,
      status: list.status,
      canRefresh,
      problems: list.status === 'invalid' ? list.problems : [],
      done: done([]),
    }
  }
  const rows: EffectRow[] = list.effects.map((effect) => {
    const own = overrides[effect.id]
    const description = own?.text ?? effect.description
    const loops = Boolean(effect.loops)
    const now = { description, seconds: effect.seconds, loops }
    const entry = state.chosen?.[effect.id]
    const status = effectStatus({
      lockUnread: state.chosen === null,
      chosen: entry,
      now,
      hasTakes: state.takesMade.has(effect.id),
    })
    return {
      id: effect.id,
      name: effect.title ?? effectName(effect.id),
      description,
      gameDescription: effect.description,
      seconds: effect.seconds,
      loops,
      changedHere: Boolean(own),
      gameChanged: Boolean(own) && own!.gameWas !== effect.description,
      status,
      current:
        state.chosen === null
          ? ({ kind: 'unknown' } as const)
          : entry
            ? ({ kind: 'take', take: entry.lock.take, exists: entry.fileExists } as const)
            : ({ kind: 'nothing' } as const),
      changed: entry ? effectChangedFields(entry.lock, now) : [],
      chosen: Boolean(entry),
    }
  })
  const listed = new Set([...rows.map((r) => r.id), ...list.seenIds])
  const dropped = Object.entries(overrides)
    .filter(([id]) => !listed.has(id))
    .map(([id, own]) => ({ id, name: effectName(id), words: own.text }))
  return {
    status: 'ok',
    canRefresh,
    rows,
    dropped,
    unreadable: list.unreadable,
    problems: list.problems,
    done: {
      done: rows.filter((r) => r.status === 'chosen').length,
      total: rows.length,
      needs: rows.filter((r) => r.status !== 'chosen').map((r) => r.id),
    },
  }
}
