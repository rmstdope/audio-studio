import { z } from 'zod'
import {
  changedFields,
  trackStatus,
  type ChangedField,
  type LockEntry,
  type TrackStatus,
} from './musicChoose'
import type { Problem } from './project'

/** The longest stinger the game may ask for, in seconds. */
export const MAX_STINGER_SECONDS = 10

/** Music files the studio can play, by extension. */
const AUDIO_FILE = /\.(mp3|ogg|wav|m4a|flac)$/i

/** The path of a music file the game plays: inside the project root, and an audio file. */
const GameFile = z
  .string()
  .min(1)
  .refine((file) => !/^([/\\]|[a-z]:)/i.test(file) && !file.split(/[/\\]/).includes('..'), {
    error: 'use a path inside the project (no leading / and no ..)',
  })
  .refine((file) => AUDIO_FILE.test(file), {
    error: 'use an audio file (.mp3, .ogg, .wav, .m4a or .flac)',
  })

/** A track as the game lists it. `plays` is where the game plays it, shown under its name; `file` is the music file it plays now. */
const TrackShape = z.object({
  id: z
    .string()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'use lower-case letters, digits and - only (it names the music file)',
    ),
  title: z.string().min(1),
  plays: z.string().min(1).optional(),
  file: GameFile.optional(),
  brief: z.string().min(1),
  seconds: z.number().int().positive(),
  bpm: z.number().int().min(30).max(300).optional(),
  key: z.string().min(1).optional(),
})

/** One track of a list the game writes. */
export const TrackSchema = TrackShape

/** An act's loops, in the game's order (a list that is there and empty means the game asks for none). */
export const LoopListSchema = z.array(TrackSchema)

/** The stingers of the whole game, in the game's order. */
export const StingerListSchema = z.array(
  TrackSchema.refine((track) => track.seconds <= MAX_STINGER_SECONDS, {
    path: ['seconds'],
    error: `a stinger is at most ${MAX_STINGER_SECONDS} seconds`,
  }),
)

/** What the studio changed of one track's game-given values; null for bpm or key means none. */
const BriefChange = z.object({
  brief: z.string().min(1).optional(),
  seconds: z.number().int().positive().optional(),
  bpm: z.number().int().min(30).max(300).nullable().optional(),
  key: z.string().min(1).nullable().optional(),
})

/** `briefs.json`: the studio's changes to the game's briefs, by track id. */
export const BriefsSchema = z.record(z.string(), BriefChange)

/** A track of a game-written list. */
export type Track = z.infer<typeof TrackSchema>

/** The studio's changes to the briefs, by track id. */
export type Briefs = z.infer<typeof BriefsSchema>

/** What reading one list gave: its tracks, no file yet, or a file that failed validation. */
export type MusicListState =
  { status: 'ok'; tracks: Track[] } | { status: 'missing' } | { status: 'invalid' }

/** A list read from disk, with what the summary needs to know about it. */
export interface MusicListInput {
  /** The part's id for an act's loops, `stingers` for the stingers. */
  id: string
  kind: 'act' | 'stingers'
  title: string
  /** The list's file, relative to the project root, for problems. */
  file: string
  state: MusicListState
  /** Whether the project has a command that refreshes this list. */
  canRefresh: boolean
}

/** The values the game gave a track, which the studio's changes are over. */
export interface GameBrief {
  brief: string
  seconds: number
  bpm: number | null
  key: string | null
}

/** What a row's play button plays: the chosen take, else the game's own file, else nothing. */
export type CurrentMusic =
  | { kind: 'take'; take: number; exists: boolean }
  | { kind: 'game'; file: string; exists: boolean }
  | { kind: 'none' }

/** A track as a list page shows it; its brief, length, tempo and key are the ones in force. */
export interface TrackRow {
  id: string
  title: string
  plays: string | null
  brief: string
  seconds: number
  bpm: number | null
  key: string | null
  /** What the game's list says, for "from the game" and "use the game's". */
  game: GameBrief
  /** Chosen, not chosen, changed since chosen, or its music file missing. */
  status: TrackStatus
  /** What changed since the take was chosen; empty unless the status is `changed`. */
  changed: ChangedField[]
  /** When the take was chosen (ISO time); null when none is. */
  chosenAt: string | null
  /** What the play button plays now. */
  current: CurrentMusic
}

/** What the lock says of a track and whether its music file is on disk. */
export interface ChosenState {
  lock: LockEntry
  fileExists: boolean
}

/** A track the game no longer asks for whose music is still there, as its list's page shows it. */
export interface OrphanRow {
  id: string
  /** The id as words: the lock keeps no title. */
  title: string
  /** Its music file's name in the clips folder. */
  file: string
  /** When its take was chosen (ISO time). */
  chosenAt: string
  /** Whether the music file is still on disk. */
  fileExists: boolean
}

/** One page of Music: an act's loops or the stingers. */
export interface MusicListSummary {
  id: string
  kind: 'act' | 'stingers'
  title: string
  state: MusicListState['status']
  tracks: TrackRow[]
  /** Chosen tracks this list no longer names, by id; none while the list is missing or unreadable. */
  orphans: OrphanRow[]
  /** Tracks the game lists that are not shown because their id is used more than once. */
  dropped: number
  canRefresh: boolean
}

/** The Music workspace as the UI shows it. */
export interface MusicSummary {
  lists: MusicListSummary[]
}

/**
 * The Music pages from the lists the game wrote and the studio's changes to their briefs. An id
 * used twice, in one list or two, is a problem at every place it is used, and none of those
 * tracks is shown: which one the music file belongs to is not for the studio to guess.
 */
export function summarizeMusic(
  lists: MusicListInput[],
  briefs: Briefs,
  chosen: Record<string, ChosenState> = {},
  gameFiles: Record<string, boolean> = {},
): { music: MusicSummary; problems: Problem[] } {
  const uses = new Map<string, { file: string; path: string }[]>()
  for (const list of lists) {
    if (list.state.status !== 'ok') continue
    list.state.tracks.forEach((track, index) => {
      const places = uses.get(track.id) ?? []
      places.push({ file: list.file, path: `[${index}].id` })
      uses.set(track.id, places)
    })
  }
  const problems: Problem[] = []
  for (const list of lists) {
    if (list.state.status !== 'ok') continue
    list.state.tracks.forEach((track, index) => {
      const places = uses.get(track.id)!
      if (places.length < 2) return
      const others = places.filter(
        (place) => place.file !== list.file || place.path !== `[${index}].id`,
      )
      problems.push({
        file: list.file,
        path: `[${index}].id`,
        message: `the id "${track.id}" is also used at ${others.map((p) => `${p.file}${p.path}`).join(', ')}; none of those tracks is shown until each id is used once`,
      })
    })
  }
  const named = new Set(uses.keys())
  return {
    music: {
      lists: lists.map((list) => ({
        id: list.id,
        kind: list.kind,
        title: list.title,
        state: list.state.status,
        tracks: shown(list, uses).map((track) =>
          rowOf(track, briefs[track.id], list.kind, chosen[track.id], gameFiles[track.id] ?? false),
        ),
        orphans: orphansOf(list, named, chosen),
        dropped: listed(list).length - shown(list, uses).length,
        canRefresh: list.canRefresh,
      })),
    },
    problems,
  }
}

/** The chosen tracks the list's lock entries name and no list names any more. */
function orphansOf(
  list: MusicListInput,
  named: Set<string>,
  chosen: Record<string, ChosenState>,
): OrphanRow[] {
  if (list.state.status !== 'ok') return []
  return Object.keys(chosen)
    .sort()
    .filter((id) => chosen[id]!.lock.list === list.id && !named.has(id))
    .map((id) => ({
      id,
      title: orphanTitle(id),
      file: `${id}.mp3`,
      chosenAt: chosen[id]!.lock.at,
      fileExists: chosen[id]!.fileExists,
    }))
}

/** A track id as words ("castle-gates" is "Castle gates"). */
export function orphanTitle(id: string): string {
  const words = id.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The orphan with this id and the list that shows it, or undefined when it is not one. */
export function orphanOf(
  lists: MusicListSummary[],
  id: string,
): { list: MusicListSummary; orphan: OrphanRow } | undefined {
  for (const list of lists) {
    const orphan = list.orphans.find((o) => o.id === id)
    if (orphan) return { list, orphan }
  }
  return undefined
}

/**
 * Of these ids (kept briefs and boards), those of tracks never chosen that the game no longer
 * lists. Nothing while any list is missing, unreadable or has a repeated id: which list named a
 * track that was never chosen is not known, so the game must have said everything.
 */
export function staleIds(music: MusicSummary, candidates: string[], chosenIds: string[]): string[] {
  if (music.lists.some((list) => list.state !== 'ok' || list.dropped > 0)) return []
  const named = new Set(music.lists.flatMap((list) => list.tracks.map((track) => track.id)))
  const kept = new Set(chosenIds)
  return candidates.filter((id) => !named.has(id) && !kept.has(id))
}

function listed(list: MusicListInput): Track[] {
  return list.state.status === 'ok' ? list.state.tracks : []
}

/** The list's tracks whose id is used once in the whole game. */
function shown(list: MusicListInput, uses: Map<string, unknown[]>): Track[] {
  return listed(list).filter((track) => uses.get(track.id)!.length === 1)
}

function rowOf(
  track: Track,
  change: Briefs[string] | undefined,
  kind: MusicListInput['kind'],
  chosen: ChosenState | undefined,
  gameFileExists: boolean,
): TrackRow {
  const row = {
    id: track.id,
    title: track.title,
    plays: track.plays ?? null,
    brief: change?.brief ?? track.brief,
    seconds: change?.seconds ?? track.seconds,
    // `null` is the studio's "none", over a tempo or key the game gave.
    bpm: change?.bpm === undefined ? (track.bpm ?? null) : change.bpm,
    key: change?.key === undefined ? (track.key ?? null) : change.key,
    game: {
      brief: track.brief,
      seconds: track.seconds,
      bpm: track.bpm ?? null,
      key: track.key ?? null,
    },
  }
  const current = {
    brief: row.brief,
    kind: kind === 'stingers' ? ('stinger' as const) : ('loop' as const),
    seconds: row.seconds,
    bpm: row.bpm,
    key: row.key,
  }
  const status = trackStatus({
    lock: chosen?.lock,
    current,
    fileExists: chosen?.fileExists ?? false,
  })
  return {
    ...row,
    status,
    changed: status === 'changed' ? changedFields(chosen!.lock, current) : [],
    chosenAt: chosen?.lock.at ?? null,
    current: chosen
      ? { kind: 'take', take: chosen.lock.take, exists: chosen.fileExists }
      : track.file
        ? { kind: 'game', file: track.file, exists: gameFileExists }
        : { kind: 'none' },
  }
}

/** A track named in a refresh's summary. */
export interface TrackRef {
  id: string
  title: string
}

/** The tracks a refresh added and removed, by id, in list order. */
export function loopsDiff(
  before: Track[],
  after: Track[],
): { added: TrackRef[]; removed: TrackRef[] } {
  const had = new Set(before.map((track) => track.id))
  const has = new Set(after.map((track) => track.id))
  const ref = ({ id, title }: Track): TrackRef => ({ id, title })
  return {
    added: after.filter((track) => !had.has(track.id)).map(ref),
    removed: before.filter((track) => !has.has(track.id)).map(ref),
  }
}

/** A field of a track's brief that the studio can change. */
export type BriefField = 'brief' | 'seconds' | 'bpm' | 'key'

/** The value of a brief field: text for the brief and key, whole numbers otherwise, null for none. */
export type BriefValue = string | number | null

/**
 * Where a field's value in force comes from: the game's, a change made here, or nothing (the
 * game gave no tempo or key and none was set).
 */
export function fieldSource(row: TrackRow, field: BriefField): 'game' | 'changed' | 'unset' {
  if (row[field] === row.game[field]) return row[field] === null ? 'unset' : 'game'
  return 'changed'
}

const FIELD_ORDER: BriefField[] = ['brief', 'seconds', 'bpm', 'key']

/**
 * The briefs with one field of a track set to `value`. A value the game already has removes the
 * change (and the track's entry once nothing is left of it); `null` for tempo or key means none
 * over the game's. Entries stay in id order, so the file's diffs stay small.
 */
export function applyBriefChange(
  briefs: Briefs,
  id: string,
  field: BriefField,
  value: BriefValue,
  game: GameBrief,
): Briefs {
  const { [id]: before, ...others } = briefs
  const changed: Record<string, BriefValue | undefined> = { ...before }
  if (value === game[field]) delete changed[field]
  else changed[field] = value
  // Always in the same order, so setting fields in another order is no diff.
  const entry = Object.fromEntries(
    FIELD_ORDER.flatMap((f) => (f in changed ? [[f, changed[f]]] : [])),
  )
  const next: Briefs = { ...others }
  if (Object.keys(entry).length) next[id] = entry
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** The list that holds a track and its row, by id. */
export function trackFor<L extends { tracks: TrackRow[] }>(
  lists: L[],
  id: string,
): { list: L; track: TrackRow } | undefined {
  for (const list of lists) {
    const track = list.tracks.find((t) => t.id === id)
    if (track) return { list, track }
  }
  return undefined
}

/** A length typed as m:ss (`1:20` is 80), or null when it is not one or is zero. */
export function parseClock(text: string): number | null {
  const match = /^(\d+):([0-5]\d)$/.exec(text.trim())
  if (!match) return null
  const seconds = Number(match[1]) * 60 + Number(match[2])
  return seconds > 0 ? seconds : null
}

/** One field of a track's brief to change (the body of a save); null means no tempo or key. */
export const BriefChangeBody = z.union([
  z.object({ brief: z.string() }).strict(),
  z.object({ seconds: z.number().int().positive() }).strict(),
  z.object({ bpm: z.number().int().min(30).max(300).nullable() }).strict(),
  z.object({ key: z.string().max(100).nullable() }).strict(),
])

/** A change to one field of a track's brief. */
export type BriefChange = z.infer<typeof BriefChangeBody>
