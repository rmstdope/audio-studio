import { trackFor, type MusicListSummary } from '../../../core/music'
import type { ProjectSummary } from '../../../core/summary'
import type {
  RefreshEffectsResult,
  RefreshResult,
  RefreshSharedResult,
} from '../../../services/refresh'
import { useMusicMaking, useRefreshDialog, useRefreshShared } from '../../api'
import { STATUS_LABEL, tracksDone, type TrackStatus } from '../../../core/musicChoose'
import { useId, useState } from 'react'
import { Problems } from '../../components/Problems'
import { PlayIcon, StopIcon } from '../../components/icons'
import { useClipPlayer } from '../../components/useClipPlayer'
import { canPlay, playLabel, playsText, type PlayFailure } from '../../musicPlays'
import { clock, shortTitle } from '../../format'
import { makingStatusText } from '../../musicTakesText'
import { changeSummary, listFor, listLine, listNotice } from '../../musicText'
import { routeHref, type MusicRoute } from '../../route'
import { REFRESH_BLOCKED_BY_TAKES, type Noun } from '../../musicMakeAllText'
import { showingAttentionText } from '../../status'
import { DoneStat } from '../../components/DoneStat'
import { MakeAllPanel } from './MakeAllPanel'
import { NoMusic } from './NoMusic'
import { OrphansPanel } from './OrphansPanel'
import { TrackView } from './TrackView'

/** The chip class of each status: green when chosen, amber when it needs a look. */
const STATUS_CHIP: Record<TrackStatus, string> = {
  chosen: 'chip chip-ok',
  'not-chosen': 'chip',
  changed: 'chip chip-warn',
  missing: 'chip chip-warn',
  unknown: 'chip chip-warn',
}

/** A Music page: an act's loops or the stingers, or how to set Music up when the project has none. */
export function MusicView({ summary, route }: { summary: ProjectSummary; route: MusicRoute }) {
  if (!summary.music) return <NoMusic />
  const list = listFor(summary.music.lists, route)
  if (!list) return <NoMusic />
  const found = route.page === 'track' ? trackFor(summary.music.lists, route.track) : undefined
  if (found) return <TrackView list={found.list} lists={summary.music.lists} track={found.track} />
  const attention = 'show' in route && route.show === 'attention'
  return list.kind === 'stingers' ? (
    <StingersPage key="stingers" list={list} attention={attention} />
  ) : (
    <ActPage key={list.id} list={list} attention={attention} />
  )
}

/** What a page's Refresh from the game button does and shows. */
interface Refresh {
  start: () => void
  pending: boolean
  panel: React.ReactNode
}

function ActPage({ list, attention }: { list: MusicListSummary; attention: boolean }) {
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
  return (
    <ListPage
      list={list}
      refresh={{ start: run.start, pending: run.pending, panel }}
      attention={attention}
    />
  )
}

function StingersPage({ list, attention }: { list: MusicListSummary; attention: boolean }) {
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
  return (
    <ListPage
      list={list}
      refresh={{ start: run.start, pending: run.pending, panel }}
      attention={attention}
    />
  )
}

/**
 * A list of tracks (an act's loops or the stingers): how many are up to date, linking to those that
 * need attention, and the tracks, all of them or (`attention`) only those.
 */
function ListPage({
  list,
  refresh,
  attention,
}: {
  list: MusicListSummary
  refresh: Refresh
  attention: boolean
}) {
  const name = list.kind === 'stingers' ? 'Stingers' : shortTitle(list.title)
  const page = (show?: 'attention') =>
    routeHref(
      list.kind === 'stingers'
        ? { view: 'music', page: 'stingers', show }
        : { view: 'music', page: 'act', part: list.id, show },
    )
  const done = tracksDone(list.tracks)
  const shown = attention ? list.tracks.filter((t) => done.needs.includes(t.id)) : list.tracks
  const notice = listNotice(list, name)
  const making = useMusicMaking().data ?? {}
  const noun: Noun = list.kind === 'stingers' ? 'stinger' : 'track'
  const refreshReasonId = useId()
  // On the Stingers page the refresh and the making of takes cannot run together, and it shows.
  const takesBlockRefresh =
    list.kind === 'stingers' && list.tracks.some((t) => (making[t.id]?.takes ?? 0) > 0)
  // Why the last press of play failed, by track; cleared when the row is pressed again.
  const [failed, setFailed] = useState<Record<string, PlayFailure>>({})
  const player = useClipPlayer((id) => {
    void whyFailed(currentUrl(id)).then((why) => setFailed((was) => ({ ...was, [id]: why })))
  })
  const playing = player.playing
  const press = (id: string) => {
    setFailed(({ [id]: _, ...rest }) => rest)
    // A chosen take fades in and out; the game's own file plays as it is.
    const fade = list.tracks.find((t) => t.id === id)?.current.kind === 'take'
    player.toggle(id, currentUrl(id), { fade })
  }
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
              aria-disabled={takesBlockRefresh || undefined}
              aria-describedby={takesBlockRefresh ? refreshReasonId : undefined}
              title={takesBlockRefresh ? REFRESH_BLOCKED_BY_TAKES : undefined}
              onClick={takesBlockRefresh ? undefined : refresh.start}
            >
              {refresh.pending ? 'Refreshing from the game…' : 'Refresh from the game'}
            </button>
            {takesBlockRefresh && (
              <span id={refreshReasonId} hidden>
                {REFRESH_BLOCKED_BY_TAKES}
              </span>
            )}
          </div>
        )}
      </header>
      {refresh.panel}
      {!notice && list.tracks.length > 0 && (
        <section
          className="panel status-panel"
          aria-label={`${noun === 'stinger' ? 'Stingers' : 'Tracks'} up to date`}
        >
          <MakeAllPanel
            list={list}
            noun={noun}
            refreshing={list.kind === 'stingers' && refresh.pending}
          >
            <div className="stats">
              <DoneStat
                label={`${noun === 'stinger' ? 'Stingers' : 'Tracks'} up to date`}
                done={done.done}
                total={done.total}
                href={page('attention')}
              />
            </div>
          </MakeAllPanel>
          {attention && (
            <p className="status-note muted">
              {showingAttentionText(shown.length, noun)} <a href={page()}>Show all</a>
            </p>
          )}
        </section>
      )}
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
                <th>{noun === 'stinger' ? 'Stinger' : 'Track'}</th>
                <th className="music-brief-cell">Brief</th>
                <th>Length</th>
                <th>Plays</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((track) => {
                return (
                  <tr key={track.id}>
                    <td className="music-play">
                      {(canPlay(track.current) || playing === track.id) && (
                        <button
                          className={playing === track.id ? 'icon-btn music-stop' : 'icon-btn'}
                          type="button"
                          aria-label={playLabel(track.title, track.current, playing === track.id)}
                          onClick={() => press(track.id)}
                        >
                          {playing === track.id ? <StopIcon /> : <PlayIcon />}
                        </button>
                      )}
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
                    <PlaysCell text={playsText(track.current, failed[track.id])} />
                    <td>
                      {making[track.id]?.takes ? (
                        <span className="chip">{makingStatusText(making[track.id]!)}</span>
                      ) : (
                        <span className={STATUS_CHIP[track.status]}>
                          {STATUS_LABEL[track.status]}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <OrphansPanel orphans={list.orphans} />
    </>
  )
}

/** The outcome of a refresh from the game, with what was added and removed. */
export function RefreshPanel({
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
export function FailedPanel({
  result,
  error,
  onClose,
}: {
  result: RefreshResult | RefreshSharedResult | RefreshEffectsResult
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

/** The API path of the music a track plays now. */
function currentUrl(id: string): string {
  return `/api/music/tracks/${encodeURIComponent(id)}/current`
}

/** Why a play failed: the file is gone since the page loaded, or it is there but will not open. */
async function whyFailed(url: string): Promise<PlayFailure> {
  try {
    const response = await fetch(url)
    void response.body?.cancel()
    return response.status === 404 ? 'gone' : 'open'
  } catch {
    return 'open'
  }
}

/** What a row plays, beside its button: take or the game's file, its name, and any red line. */
function PlaysCell({ text }: { text: ReturnType<typeof playsText> }) {
  return (
    <td className="music-plays">
      <span className={text.faint ? 'music-plays-none' : undefined}>{text.lead}</span>
      {text.file && (
        <div className="mono muted music-id" title={text.path}>
          {text.file}
        </div>
      )}
      {text.missing && <div className="music-plays-err">{text.missing}</div>}
      {text.failure && (
        <div className="music-plays-err" role="status">
          {text.failure}
        </div>
      )}
    </td>
  )
}
