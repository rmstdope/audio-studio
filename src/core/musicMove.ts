import type { MusicListSummary } from './music'
import { STATUS_LABEL } from './musicChoose'
import type { BoardTake, MakingSummary, TakeInputs } from './musicTake'

/** A track a take can move to, as a row of the dialog's list. */
export interface MoveTarget {
  id: string
  title: string
  /** The track the take is on now: listed, but it cannot be picked. */
  here: boolean
  /** Its status and length ("not chosen · 1:00"); "this track" for the track the take is on. */
  line: string
}

/** An act's loops, or the stingers, in the dialog's list. */
export interface MoveGroup {
  /** The act's name ("Act 2"); null for the stingers, which have no grouping. */
  heading: string | null
  /** What the group says when the game has not listed its tracks yet; null otherwise. */
  notListed: string | null
  tracks: MoveTarget[]
}

/** What a dialog's search says when no title contains the text. */
export const NO_MATCH = 'No loop is called that.'

/** An act's title before its colon (`Act 1: The Call` → `Act 1`). */
export function actName(title: string): string {
  const colon = title.indexOf(':')
  return colon > 0 ? title.slice(0, colon) : title
}

/** A length as m:ss. */
function clock(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * The tracks a take of this kind can move to: the loops of the whole game grouped under their
 * acts in game order, or the stingers; the track it is on is listed, marked. `making` is what each
 * track is making now, by id.
 */
export function moveTargets(
  lists: readonly MusicListSummary[],
  from: { id: string; kind: 'loop' | 'stinger' },
  making: Record<string, MakingSummary> = {},
): { groups: MoveGroup[] } {
  const wanted = from.kind === 'stinger' ? 'stingers' : 'act'
  const groups = lists
    .filter((list) => list.kind === wanted)
    .map((list): MoveGroup => {
      const act = actName(list.title)
      return {
        heading: list.kind === 'stingers' ? null : act,
        notListed:
          list.kind === 'act' && list.state === 'missing'
            ? `The game has not listed the loops for ${act} yet.`
            : null,
        tracks: list.tracks.map((track) => {
          const busy = making[track.id]
          const here = track.id === from.id
          const status = busy
            ? `making ${busy.takes} ${busy.takes === 1 ? 'take' : 'takes'}`
            : STATUS_LABEL[track.status]
          return {
            id: track.id,
            title: track.title,
            here,
            line: here ? 'this track' : `${status} · ${clock(track.seconds)}`,
          }
        }),
      }
    })
  return { groups }
}

/** The groups whose track titles contain `query` (any case); empty groups drop out. */
export function filterTargets(groups: readonly MoveGroup[], query: string): MoveGroup[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...groups]
  return groups
    .map((group) => ({
      ...group,
      tracks: group.tracks.filter((t) => t.title.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.tracks.length > 0)
}

/** Whether the groups hold no track but the one the take is on. */
export function hasNowhere(groups: readonly MoveGroup[]): boolean {
  return !groups.some((group) => group.tracks.some((t) => !t.here))
}

/** The dialog's title: "Move take 3 to another loop". */
export function moveTitle(n: number, kind: 'loop' | 'stinger'): string {
  return `Move take ${n} to another ${kind}`
}

/** The dialog's line under the title. */
export function moveLine(fromTitle: string, kind: 'loop' | 'stinger'): string {
  return `It leaves ${fromTitle} and joins the takes of the ${kind} you pick.`
}

/** A refusal under the dialog's list. */
export function moveFailure(n: number, reason: string): string {
  return `Take ${n} could not be moved: ${reason.replace(/\.$/, '')}. Nothing was changed.`
}

/** Why Move… is greyed when the game has no other track of the kind. */
export function nowhereLine(kind: 'loop' | 'stinger'): string {
  return `There is no other ${kind} to move it to.`
}

/**
 * The line at the top of the Takes panel after a move, in three parts so the track's name can be
 * set in bold; `act` is null for a stinger.
 */
export function movedLineParts(
  n: number,
  to: string,
  act: string | null,
  becameN: number,
): [string, string, string] {
  return [`Take ${n} moved to `, to, `${act ? ` (${act})` : ''}, where it is take ${becameN}.`]
}

/** The line a moved take keeps under its name. */
export function movedFromLine(from: { title: string; n: number }): string {
  return `moved from ${from.title}, where it was take ${from.n}`
}

/**
 * The board entry a take becomes on the track it moves to: its sound, seed, model and length as
 * they were; the destination's next number, hash and inputs, so it counts as made for that track's
 * brief; and where it came from.
 */
export function movedBoardTake(
  take: BoardTake,
  to: { n: number; hash: string; inputs: TakeInputs; from: string },
): BoardTake {
  return {
    ...take,
    n: to.n,
    hash: to.hash,
    inputs: to.inputs,
    movedFrom: { title: to.from, n: take.n },
  }
}
