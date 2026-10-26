import type { MakingView, MusicTakesView, TakeView } from '../../../core/musicTake'
import { useDropTake, useMakeTakes, useMusicTakes, useStopTakes } from '../../api'
import { Failure } from '../../components/Failure'
import { Problems } from '../../components/Problems'
import { useClipPlayer } from '../../components/useClipPlayer'
import { clock } from '../../format'
import { failureLine, progressOf, timeLeftText } from '../../musicTakesText'
import { routeHref } from '../../route'

/**
 * A track's Takes panel: the takes made, played from the start and, for a loop, around their
 * seam; the ones being made; and "Make 2 takes" when there are none yet. A take that failed says
 * why, with Try again; without the music generator on this computer, it says so and links Setup.
 */
export function TakesPanel({ trackId }: { trackId: string }) {
  const takes = useMusicTakes(trackId)
  const make = useMakeTakes(trackId)
  const stop = useStopTakes(trackId)
  const player = useClipPlayer()
  const view = takes.data
  if (!view)
    return (
      <section className="panel">
        {takes.isError ? 'The takes could not be loaded.' : 'Loading takes…'}
      </section>
    )
  if (!('making' in view))
    return <Problems title="The takes could not be listed" problems={view.problems} />
  const { generator } = view
  const none = !view.takes.length && !view.making.length
  const result = make.data
  return (
    <>
      {!generator.ok && (
        <div className="errbox" role="alert">
          <div className="errbox-text">
            <strong>Music can't be made on this computer yet.</strong>
            <span className="muted small">
              The music generator or its models aren't installed. Setup says what is missing.
            </span>
          </div>
          <a className="btn" href={routeHref({ view: 'setup' })}>
            Open Setup
          </a>
        </div>
      )}
      {view.failed.map((failed) => (
        <div className="errbox" role="alert" key={failed.n}>
          <div className="errbox-text">
            <strong>Take {failed.n} could not be made.</strong>
            <span className="muted small">
              {failureLine(failed.message, view.takes.length > 0)}
            </span>
          </div>
          <button
            type="button"
            className="btn"
            disabled={make.isPending || !generator.ok}
            onClick={() => make.mutate({ retry: failed.n })}
          >
            Try again
          </button>
        </div>
      ))}
      <section className="panel takes-panel">
        <div className="takes-head">
          <h2>Takes</h2>
          {!none && (
            <>
              {view.making.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={stop.isPending || !view.making.some((m) => m.state === 'waiting')}
                  onClick={() => stop.mutate()}
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!generator.ok || make.isPending || view.making.length > 0}
                onClick={() => make.mutate({ count: 2 })}
              >
                More takes
              </button>
            </>
          )}
        </div>
        {none ? (
          <div className="takes-empty">
            <strong>No takes yet</strong>
            <span className="muted">
              Each take is new music made from the brief, about 3 minutes each.
              <br />
              Make a few, listen, and choose the one the game plays.
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!generator.ok || make.isPending}
              onClick={() => make.mutate({ count: 2 })}
            >
              Make 2 takes
            </button>
          </div>
        ) : (
          <div className="takes">
            {view.takes.map((take) => (
              <TakeCard
                key={take.n}
                trackId={trackId}
                kind={view.kind}
                take={take}
                player={player}
              />
            ))}
            {view.making.map((making, index) => (
              <MakingCard key={making.n} making={making} view={view} first={index === 0} />
            ))}
          </div>
        )}
        <Failure title="The takes could not be made" result={result} />
        {make.isError && <span className="adopt-error">{make.error.message}</span>}
      </section>
    </>
  )
}

/** A take made: play, its waveform with the seam of a loop marked, its length, and Hear the seam. */
function TakeCard({
  trackId,
  kind,
  take,
  player,
}: {
  trackId: string
  kind: MusicTakesView['kind']
  take: TakeView
  player: ReturnType<typeof useClipPlayer>
}) {
  const id = `music-take-${trackId}-${take.n}`
  const url = `/api/music/tracks/${encodeURIComponent(trackId)}/takes/${take.file}`
  const playing = player.playing === id
  const seamId = `${id}-seam`
  const seamPlaying = player.playing === seamId
  const drop = useDropTake(trackId)
  return (
    <div className="take">
      <div className="take-row">
        <b className="grow">Take {take.n}</b>
        {take.earlier && <span className="faint small">earlier brief</span>}
      </div>
      <div className="take-row">
        <button
          type="button"
          className="play"
          aria-label={`${playing ? 'Stop' : 'Play'} take ${take.n}`}
          onClick={() => player.toggle(id, url)}
        >
          {playing ? '■' : '▶'}
        </button>
        <div className="wave" aria-hidden>
          {take.peaks.map((peak, i) => (
            <i key={i} style={{ height: `${Math.max(4, peak * 100)}%` }} />
          ))}
          {kind === 'loop' && <span className="seam" />}
        </div>
        <span className="faint small">{clock(take.seconds)}</span>
      </div>
      <div className="take-row">
        {kind === 'loop' && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => player.toggle(seamId, `${url}?seam=1`)}
          >
            {seamPlaying ? 'Stop' : 'Hear the seam'}
          </button>
        )}
        <span className="grow" />
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={drop.isPending}
          onClick={() => {
            if (playing || seamPlaying) player.stop()
            drop.mutate(take.file)
          }}
        >
          Drop
        </button>
      </div>
    </div>
  )
}

/** A take waiting or being made: a dashed card with a progress bar and the time left. */
function MakingCard({
  making,
  view,
  first,
}: {
  making: MakingView
  view: MusicTakesView
  first: boolean
}) {
  return (
    <div className="take take-making">
      <div className="take-row">
        <b>Take {making.n}</b>
        <span className="small">{timeLeftText(making, view.expected)}</span>
      </div>
      <div className="bar" role="progressbar" aria-label={`Take ${making.n}`}>
        <i style={{ width: `${Math.round(progressOf(making, view.expected) * 100)}%` }} />
      </div>
      {first && (
        <span className="small faint">
          Carry on listening, or leave the page: the takes are made either way.
        </span>
      )}
    </div>
  )
}
