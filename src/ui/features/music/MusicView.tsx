import { trackFor, type MusicListSummary } from '../../../core/music'
import type { ProjectSummary } from '../../../core/summary'
import type { RefreshResult, RefreshSharedResult } from '../../../services/refresh'
import { useMusicMaking, useRefreshDialog, useRefreshShared } from '../../api'
import { Problems } from '../../components/Problems'
import { PlayIcon } from '../../components/icons'
import { clock, shortTitle } from '../../format'
import { makingStatusText } from '../../musicTakesText'
import { changeSummary, listFor, listLine, listNotice } from '../../musicText'
import { routeHref, type MusicRoute } from '../../route'
import { NoMusic } from './NoMusic'
import { TrackView } from './TrackView'

/** A Music page: an act's loops or the stingers, or how to set Music up when the project has none. */
export function MusicView({ summary, route }: { summary: ProjectSummary; route: MusicRoute }) {
  if (!summary.music) return <NoMusic />
  const list = listFor(summary.music.lists, route)
  if (!list) return <NoMusic />
  const found = route.page === 'track' ? trackFor(summary.music.lists, route.track) : undefined
  if (found) return <TrackView list={found.list} track={found.track} />
  return list.kind === 'stingers' ? (
    <StingersPage key="stingers" list={list} />
  ) : (
    <ActPage key={list.id} list={list} />
  )
}

/** What a page's Refresh from the game button does and shows. */
interface Refresh {
  start: () => void
  pending: boolean
  panel: React.ReactNode
}

function ActPage({ list }: { list: MusicListSummary }) {
  const run = useRefreshDialog(list.id)
  const result = run.outcome?.result
  let panel: React.ReactNode = null
  if (run.outcome) {
    if (result?.ok) {
      const summary = result.loops
        ? changeSummary({ total: result.loops.total, noun: 'loop', change: result.loops })
        : null
      panel = (
        <RefreshPanel
          title="Loops refreshed"
          headline={summary?.headline ?? 'what changed in the loops is not known'}
          added={summary?.added ?? []}
          removed={summary?.removed ?? []}
          onClose={run.dismiss}
        />
      )
    } else {
      panel = (
        <FailedPanel result={result ?? null} error={run.outcome.error} onClose={run.dismiss} />
      )
    }
  }
  return <ListPage list={list} refresh={{ start: run.start, pending: run.pending, panel }} />
}

function StingersPage({ list }: { list: MusicListSummary }) {
  const run = useRefreshShared()
  const result = run.outcome?.result
  let panel: React.ReactNode = null
  if (run.outcome) {
    if (result?.ok) {
      const summary = changeSummary({
        total: result.stingers,
        noun: 'stinger',
        change: result.change,
      })
      panel = (
        <RefreshPanel
          title="Stingers refreshed"
          headline={summary.headline}
          added={summary.added}
          removed={summary.removed}
          onClose={run.dismiss}
        />
      )
    } else {
      panel = (
        <FailedPanel result={result ?? null} error={run.outcome.error} onClose={run.dismiss} />
      )
    }
  }
  return <ListPage list={list} refresh={{ start: run.start, pending: run.pending, panel }} />
}

function ListPage({ list, refresh }: { list: MusicListSummary; refresh: Refresh }) {
  const name = list.kind === 'stingers' ? 'Stingers' : shortTitle(list.title)
  const notice = listNotice(list, name)
  const making = useMusicMaking().data ?? {}
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Music</span>
          <h1>{name}</h1>
          <span className="muted">{listLine(list, name)}</span>
        </div>
        {list.canRefresh && (
          <div className="header-actions">
            <button
              className="btn"
              type="button"
              disabled={refresh.pending}
              onClick={refresh.start}
            >
              {refresh.pending ? 'Refreshing from the game…' : 'Refresh from the game'}
            </button>
          </div>
        )}
      </header>
      {refresh.panel}
      {notice ? (
        <section className="panel">
          <p className="muted music-notice">{notice}</p>
        </section>
      ) : (
        <div className="table-box">
          <table className="table music-table">
            <thead>
              <tr>
                <th aria-label="Play" />
                <th>Track</th>
                <th>Brief</th>
                <th>Length</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.tracks.map((track) => (
                <tr key={track.id}>
                  <td className="music-play">
                    <button
                      className="icon-btn"
                      type="button"
                      disabled
                      title="No take chosen"
                      aria-label={`Play ${track.title}: no take chosen`}
                    >
                      <PlayIcon />
                    </button>
                  </td>
                  <td>
                    <a
                      className="music-track-link"
                      href={routeHref({ view: 'music', page: 'track', track: track.id })}
                    >
                      <strong>{track.title}</strong>
                    </a>
                    <div className="mono muted music-id">{track.id}</div>
                  </td>
                  <td className="music-brief-cell">
                    <div className="music-brief" title={track.brief}>
                      {track.brief}
                    </div>
                  </td>
                  <td>{clock(track.seconds)}</td>
                  <td>
                    {making[track.id] ? (
                      <span className="chip">{makingStatusText(making[track.id]!)}</span>
                    ) : (
                      <span className="chip">not chosen</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function RefreshPanel({
  title,
  headline,
  added,
  removed,
  onClose,
}: {
  title: string
  headline: string
  added: string[]
  removed: string[]
  onClose: () => void
}) {
  return (
    <section className="panel refresh-outcome" aria-label="Refresh from the game">
      <div className="refresh-head">
        <div>
          <span className="label">{title}</span>
          <strong>{headline}</strong>
        </div>
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {added.length > 0 && <span className="muted">Added: {added.join(', ')}</span>}
      {removed.length > 0 && <span className="muted">Removed: {removed.join(', ')}</span>}
    </section>
  )
}

/** The failure of a refresh: the message, the problems with the new list, and what the command said. */
function FailedPanel({
  result,
  error,
  onClose,
}: {
  result: RefreshResult | RefreshSharedResult
  error: string | null
  onClose: () => void
}) {
  const message =
    error ??
    (result && 'message' in result
      ? result.message
      : 'The command ran, but what it wrote cannot be used.')
  return (
    <section className="panel refresh-outcome" aria-label="Refresh from the game">
      <div className="refresh-head">
        <div>
          <span className="label">Refresh from the game failed</span>
          <strong>{message}</strong>
        </div>
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {result && 'problems' in result && (
        <Problems title="What the command wrote cannot be used" problems={result.problems} />
      )}
      {result && 'output' in result && result.output && (
        <pre className="refresh-output mono">{result.output}</pre>
      )}
    </section>
  )
}
