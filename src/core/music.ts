import { z } from 'zod'
import type { Problem } from './project'

/** The longest stinger the game may ask for, in seconds. */
export const MAX_STINGER_SECONDS = 10

/** A track as the game lists it. `plays` is where the game plays it, shown under its name. */
const TrackShape = z.object({
  id: z
    .string()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'use lower-case letters, digits and - only (it names the music file)',
    ),
  title: z.string().min(1),
  plays: z.string().min(1).optional(),
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

/** A track as a list page shows it. */
export interface TrackRow {
  id: string
  title: string
  plays: string | null
  brief: string
  seconds: number
  /** Only "not chosen" is known until choosing exists. */
  status: 'not-chosen'
}

/** One page of Music: an act's loops or the stingers. */
export interface MusicListSummary {
  id: string
  kind: 'act' | 'stingers'
  title: string
  state: MusicListState['status']
  tracks: TrackRow[]
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
  return {
    music: {
      lists: lists.map((list) => ({
        id: list.id,
        kind: list.kind,
        title: list.title,
        state: list.state.status,
        tracks: shown(list, uses).map((track) => rowOf(track, briefs[track.id])),
        dropped: listed(list).length - shown(list, uses).length,
        canRefresh: list.canRefresh,
      })),
    },
    problems,
  }
}

function listed(list: MusicListInput): Track[] {
  return list.state.status === 'ok' ? list.state.tracks : []
}

/** The list's tracks whose id is used once in the whole game. */
function shown(list: MusicListInput, uses: Map<string, unknown[]>): Track[] {
  return listed(list).filter((track) => uses.get(track.id)!.length === 1)
}

function rowOf(track: Track, change: Briefs[string] | undefined): TrackRow {
  return {
    id: track.id,
    title: track.title,
    plays: track.plays ?? null,
    brief: change?.brief ?? track.brief,
    seconds: change?.seconds ?? track.seconds,
    status: 'not-chosen',
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
