import { useState, type ReactNode } from 'react'
import { changedLine, type TrackStatus } from '../../../core/musicChoose'
import type { TrackRow } from '../../../core/music'
import type { MakingView, MusicTakesView, TakeView } from '../../../core/musicTake'
import {
  MUSIC_GROUPS,
  canMake as canMakeTrack,
  eachWords,
  menuEntry,
  missingOnTrack,
  tooLongOnTrack,
  type MusicModelId,
} from '../../../core/musicModels'
import { useChooseTake, useDropTake, useMakeTakes, useMusicTakes, useStopTakes } from '../../api'
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
export function TakesPanel({ track }: { track: TrackRow }) {
  const trackId = track.id
  const takes = useMusicTakes(trackId)
  const make = useMakeTakes(trackId)
  const stop = useStopTakes(trackId)
  const player = useClipPlayer()
  const view = takes.data
  // The pick holds while the page stays open; until there is one, the project's model.
  const [picked, setPicked] = useState<MusicModelId | null>(null)
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
  const model = picked ?? view.defaultModel
  const here = view.models.find((m) => m.id === model)?.installed ?? false
  const length = { kind: view.kind, seconds: track.seconds }
  const tooLong = tooLongOnTrack(model, length.kind, length.seconds)
  const canMake = generator.ok && here && !tooLong
  // Only when some other model could be picked: with none installed, Setup is the answer above.
  // A model too short for the track says so first: downloading it would not help.
  const missing =
    (tooLong || !here) && generator.ok ? (
      <span className="takes-missing small" role="status">
        {tooLong ?? missingOnTrack(model)}
      </span>
    ) : null
  const menu: ReactNode = (
    <select
      className="takes-model"
      aria-label="Model for new takes"
      value={model}
      disabled={view.making.length > 0}
      onChange={(event) => setPicked(event.target.value as MusicModelId)}
    >
      {MUSIC_GROUPS.map((group) => (
        <optgroup key={group.heading} label={group.heading}>
          {group.ids.map((id) => {
            const installed = view.models.find((m) => m.id === id)?.installed ?? false
            return (
              <option
                key={id}
                value={id}
                disabled={!installed || !canMakeTrack(id, length.kind, length.seconds)}
              >
                {menuEntry(id, installed, length)}
              </option>
            )
          })}
        </optgroup>
      ))}
    </select>
  )
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
      {track.status === 'changed' && (
        <div className="warnbox" role="status">
          <strong>{changedLine(track.changed)}</strong>
          <span className="muted small">
            The game plays the chosen take until you choose another. Make takes from the new brief
            with More takes.
          </span>
        </div>
      )}
      <section className="panel takes-panel">
        <div className="takes-head">
          <h2>Takes</h2>
          {!none && (
            <>
              {view.making.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={stop.isPending}
                  onClick={() => stop.mutate()}
                >
                  Stop
                </button>
              )}
              {menu}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canMake || make.isPending || view.making.length > 0}
                onClick={() => make.mutate({ count: 2, model })}
              >
                More takes
              </button>
            </>
          )}
        </div>
        {!none && missing}
        {none ? (
          <div className="takes-empty">
            <strong>No takes yet</strong>
            <span className="muted">
              Each take is new music made from the brief, {eachWords(model)}.
              <br />
              Make a few, listen, and choose the one the game plays.
            </span>
            <div className="takes-make">
              {menu}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canMake || make.isPending}
                onClick={() => make.mutate({ count: 2, model })}
              >
                Make 2 takes
              </button>
            </div>
            {missing}
          </div>
        ) : (
          <div className="takes">
            {view.takes.map((take) => (
              <TakeCard
                key={take.n}
                trackId={trackId}
                kind={view.kind}
                take={take}
                status={track.status}
                player={player}
              />
            ))}
            {view.making.map((making, index) => (
              <MakingCard key={making.n} making={making} first={index === 0} />
            ))}
          </div>
        )}
        <Failure title="The takes could not be made" result={result} />
        {stop.isError && <span className="adopt-error">{stop.error.message}</span>}
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
  status,
  player,
}: {
  trackId: string
  kind: MusicTakesView['kind']
  take: TakeView
  status: TrackStatus
  player: ReturnType<typeof useClipPlayer>
}) {
  const id = `music-take-${trackId}-${take.n}`
  const url = `/api/music/tracks/${encodeURIComponent(trackId)}/takes/${take.file}`
  const playing = player.playing === id
  const seamId = `${id}-seam`
  const seamPlaying = player.playing === seamId
  const drop = useDropTake(trackId)
  const choose = useChooseTake(trackId)
  // The take the game plays; if its music file is gone it can be chosen again to write it.
  const inGame = take.chosen && status !== 'missing'
  const lost = take.chosen && status === 'missing'
  return (
    <div className={inGame || lost ? 'take take-chosen' : 'take'}>
      <div className="take-row">
        <b className="grow">Take {take.n}</b>
        {inGame && <span className="chip chip-ok">chosen · in the game</span>}
        {lost && <span className="chip chip-warn">music file missing</span>}
        {take.earlier && <span className="faint small">earlier brief</span>}
      </div>
      <span className="faint small">{take.model}</span>
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
        {!take.chosen && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={drop.isPending || choose.isPending}
            onClick={() => {
              if (playing || seamPlaying) player.stop()
              drop.mutate(take.file)
            }}
          >
            Drop
          </button>
        )}
        {!inGame && (
          <button
            type="button"
            className="btn btn-small"
            disabled={choose.isPending}
            onClick={() => choose.mutate(take.file)}
          >
            {choose.isPending ? 'Choosing…' : 'Choose'}
          </button>
        )}
      </div>
      {(choose.isError || (choose.data && !choose.data.ok)) && (
        <span className="adopt-error">
          {choose.isError
            ? choose.error.message
            : choose.data && 'message' in choose.data
              ? choose.data.message
              : 'The take could not be chosen.'}
        </span>
      )}
      {(drop.isError || (drop.data && !drop.data.ok)) && (
        <span className="adopt-error">
          {drop.isError
            ? drop.error.message
            : drop.data && 'message' in drop.data
              ? drop.data.message
              : 'The take could not be dropped.'}
        </span>
      )}
    </div>
  )
}

/** A take waiting or being made: a dashed card with a progress bar and the time left. */
function MakingCard({ making, first }: { making: MakingView; first: boolean }) {
  return (
    <div className="take take-making">
      <div className="take-row">
        <b>Take {making.n}</b>
        <span className="small">{timeLeftText(making)}</span>
      </div>
      <span className="faint small">{making.model}</span>
      <div className="bar" role="progressbar" aria-label={`Take ${making.n}`}>
        <i style={{ width: `${Math.round(progressOf(making) * 100)}%` }} />
      </div>
      {first && (
        <span className="small faint">
          Carry on listening, or leave the page: the takes are made either way.
        </span>
      )}
    </div>
  )
}
