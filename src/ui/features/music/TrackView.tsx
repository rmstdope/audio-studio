import type { MusicListSummary, TrackRow } from '../../../core/music'
import { shortTitle } from '../../format'
import { routeHref } from '../../route'
import { BriefPanel } from './BriefPanel'
import { TakesPanel } from './TakesPanel'

/** A track's own page: where it plays, its Brief and its Takes. */
export function TrackView({ list, track }: { list: MusicListSummary; track: TrackRow }) {
  const name = list.kind === 'stingers' ? 'Stingers' : shortTitle(list.title)
  const listRoute =
    list.kind === 'stingers'
      ? ({ view: 'music', page: 'stingers' } as const)
      : ({ view: 'music', page: 'act', part: list.id } as const)
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">
            <a href={routeHref(listRoute)}>Music</a> › {name}
          </span>
          <h1>{track.title}</h1>
          {track.plays && <span className="muted">Plays in: {track.plays}</span>}
        </div>
      </header>
      <BriefPanel key={track.id} track={track} kind={list.kind} />
      <TakesPanel key={`takes-${track.id}`} track={track} />
    </>
  )
}
