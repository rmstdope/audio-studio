import {
  MAX_STINGER_SECONDS,
  parseClock,
  type BriefChange,
  type BriefField,
  type MusicListSummary,
  type TrackRef,
  type TrackRow,
} from '../core/music'
import { chosenLine, type TrackStatus } from '../core/musicChoose'
import { clock, plural } from './format'
import type { MusicRoute } from './route'

/** What a list page needs of a list to word its sentences. */
type ListWords = Pick<MusicListSummary, 'kind' | 'state' | 'canRefresh' | 'dropped'> & {
  tracks: readonly { status: TrackStatus }[]
}

/**
 * The line under a list page's heading: what the game asks for there and how many tracks are
 * chosen (one changed since its take was chosen still counts), with the music files that are
 * missing. Without tracks to count, the line says what the list is and no more.
 */
export function listLine(list: ListWords, name: string): string {
  const what =
    list.kind === 'stingers'
      ? 'Played once, for a moment, anywhere in the game.'
      : `The loops the game asks for in ${name}.`
  if (!list.tracks.length) return what
  if (list.tracks.some((track) => track.status === 'unknown'))
    return `${what} Which ${list.kind === 'stingers' ? 'stingers' : 'tracks'} are chosen is not known: the music lock could not be read.`
  const count = (...statuses: TrackStatus[]) =>
    list.tracks.filter((track) => statuses.includes(track.status)).length
  return `${what} ${chosenLine({
    chosen: count('chosen', 'changed'),
    total: list.tracks.length,
    missing: count('missing'),
  })}`
}

/**
 * What the page says in place of a table: the game asks for nothing, has not listed anything yet
 * (with the invitation to refresh if there is a button), or its list could not be read. Null when
 * there are tracks to show.
 */
export function listNotice(list: ListWords, name: string): string | null {
  if (list.tracks.length) return null
  const loops = list.kind === 'stingers' ? 'the stingers' : `the loops for ${name}`
  if (list.state === 'invalid') {
    const which = list.kind === 'stingers' ? 'stingers' : `loops for ${name}`
    return `The list of ${which} could not be read; the problems above say why.`
  }
  if (list.dropped > 0) {
    const where = list.kind === 'stingers' ? 'the stingers' : name
    return `The game lists ${plural(list.dropped, 'track')} for ${where}, but their ids are used more than once; the problems above say why.`
  }
  if (list.state === 'missing') {
    const sentence = `The game has not listed ${loops} yet.`
    return list.canRefresh ? `${sentence} Refresh from the game.` : sentence
  }
  return list.kind === 'stingers'
    ? 'The game asks for no stingers.'
    : `The game asks for no loops in ${name}.`
}

/** A refresh's result as the Music page words it: a headline, and the titles added and removed. */
export function changeSummary({
  total,
  noun,
  change,
}: {
  total: number
  noun: 'loop' | 'stinger'
  change: { added: TrackRef[]; removed: TrackRef[] } | null
}): { headline: string; added: string[]; removed: string[] } {
  const count = plural(total, noun)
  if (!change) {
    return { headline: `${count} · what changed is not known`, added: [], removed: [] }
  }
  const parts = [
    change.added.length && `${change.added.length} added`,
    change.removed.length && `${change.removed.length} removed`,
  ].filter(Boolean)
  return {
    headline: `${count} · ${parts.length ? parts.join(' · ') : 'no changes'}`,
    added: change.added.map((t) => t.title),
    removed: change.removed.map((t) => t.title),
  }
}

/** The list a Music route names; the first list when it names none, or one that is not there. */
export function listFor<
  T extends Pick<MusicListSummary, 'id' | 'kind'> & { tracks: readonly { id: string }[] },
>(lists: T[], route: MusicRoute): T | undefined {
  const named =
    route.page === 'stingers'
      ? lists.find((list) => list.kind === 'stingers')
      : route.page === 'act'
        ? lists.find((list) => list.kind === 'act' && list.id === route.part)
        : route.page === 'track'
          ? lists.find((list) => list.tracks.some((track) => track.id === route.track))
          : undefined
  return named ?? lists[0]
}

/** What the tag beside a brief field's label says when the value is the game's or not set. */
export function fieldTag(source: 'game' | 'unset'): string {
  return source === 'game' ? 'from the game' : 'not set'
}

/** A brief field's value as it is typed into its input (a tempo or key that is not set is empty). */
export function fieldText(row: Pick<TrackRow, BriefField>, field: BriefField): string {
  const value = row[field]
  if (value === null) return ''
  return field === 'seconds' ? clock(row.seconds) : String(value)
}

/**
 * What was typed into a brief field as the change to save, or what is wrong with it. A stinger's
 * length is held to the ten seconds the game's list is held to.
 */
export function parseField(
  field: BriefField,
  text: string,
  kind: MusicListSummary['kind'],
): { ok: true; change: BriefChange } | { ok: false; message: string } {
  const typed = text.trim()
  if (field === 'brief') {
    return typed ? { ok: true, change: { brief: typed } } : bad('A brief cannot be empty.')
  }
  if (field === 'key') return { ok: true, change: { key: typed || null } }
  if (field === 'bpm') {
    if (!typed) return { ok: true, change: { bpm: null } }
    const bpm = Number(typed)
    return /^\d+$/.test(typed) && bpm >= 30 && bpm <= 300
      ? { ok: true, change: { bpm } }
      : bad('Use a whole number from 30 to 300.')
  }
  const seconds = parseClock(typed)
  if (seconds === null) return bad('Use minutes and seconds, like 1:20.')
  return kind === 'stingers' && seconds > MAX_STINGER_SECONDS
    ? bad(`A stinger is at most ${clock(MAX_STINGER_SECONDS)}.`)
    : { ok: true, change: { seconds } }
}

function bad(message: string): { ok: false; message: string } {
  return { ok: false, message }
}

/** When an orphan's take was chosen, as its row says it ("chosen 2 Nov"). */
export function chosenOn(at: string): string {
  const day = new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `chosen ${day}`
}
