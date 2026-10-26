import type { MusicListSummary, TrackRef } from '../core/music'
import { plural } from './format'
import type { MusicRoute } from './route'

/** What a list page needs of a list to word its sentences. */
type ListWords = Pick<MusicListSummary, 'kind' | 'state' | 'canRefresh' | 'dropped'> & {
  tracks: readonly unknown[]
}

/**
 * The line under a list page's heading: what the game asks for there and how many tracks are
 * chosen. Nothing can be chosen yet, so none is. Without tracks to count, the line says what the
 * list is and no more.
 */
export function listLine(list: ListWords, name: string): string {
  if (list.kind === 'stingers') {
    const what = 'Played once, for a moment, anywhere in the game.'
    return list.tracks.length ? `${what} 0 of ${list.tracks.length} chosen.` : what
  }
  const what = `The loops the game asks for in ${name}.`
  return list.tracks.length ? `${what} 0 of ${list.tracks.length} chosen.` : what
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
export function listFor<T extends Pick<MusicListSummary, 'id' | 'kind'>>(
  lists: T[],
  route: MusicRoute,
): T | undefined {
  const named =
    route.page === 'stingers'
      ? lists.find((list) => list.kind === 'stingers')
      : route.page === 'act'
        ? lists.find((list) => list.kind === 'act' && list.id === route.part)
        : undefined
  return named ?? lists[0]
}
