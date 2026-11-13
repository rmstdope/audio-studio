import { useRef } from 'react'
import type { MusicListSummary, TrackRow } from '../../../core/music'
import { PageHeader } from '../../components/PageHeader'
import { shortTitle } from '../../format'
import { pagerFor } from '../../pager'
import { routeHref } from '../../route'
import type { SaveWordsNow } from '../images/WordsField'
import { BriefPanel } from './BriefPanel'
import { TakesPanel } from './TakesPanel'

/** A track's own page: where it plays, its Brief and its Takes. */
export function TrackView({
  list,
  lists,
  track,
}: {
  list: MusicListSummary
  /** Every list of the game's music, for where a take can move to. */
  lists: readonly MusicListSummary[]
  track: TrackRow
}) {
  const saveBrief = useRef<SaveWordsNow>(null)
  const name = list.kind === 'stingers' ? 'Stingers' : shortTitle(list.title)
  const listRoute =
    list.kind === 'stingers'
      ? ({ view: 'music', page: 'stingers' } as const)
      : ({ view: 'music', page: 'act', part: list.id } as const)
  const pager = pagerFor(list.tracks, track.id, (t) => ({
    name: t.title,
    href: routeHref({ view: 'music', page: 'track', track: t.id }),
  }))
  return (
    <>
      <PageHeader
        title={
          <>
            <span className="crumbs">
              <a href={routeHref(listRoute)}>Music</a> › {name}
            </span>
            <h1>{track.title}</h1>
            {track.plays && <span className="muted">Plays in: {track.plays}</span>}
          </>
        }
        pager={pager}
      />
      <BriefPanel key={track.id} track={track} kind={list.kind} saveNow={saveBrief} />
      <TakesPanel
        key={`takes-${track.id}`}
        track={track}
        lists={lists}
        saveBrief={() => saveBrief.current?.() ?? null}
      />
    </>
  )
}
