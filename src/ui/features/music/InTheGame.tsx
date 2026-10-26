import { useRef, useState, type KeyboardEvent } from 'react'
import type { TrackRow } from '../../../core/music'
import { inTheGame, unchooseFailure, unchooseQuestion } from '../../../core/musicChoose'
import type { MusicTakesView, TakeView } from '../../../core/musicTake'
import { useChooseTake, useUnchooseTake } from '../../api'
import { Confirm } from '../../components/Confirm'
import { useClipPlayer } from '../../components/useClipPlayer'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { clock } from '../../format'

/** One clip at a time, shared with the takes below. */
type Player = ReturnType<typeof useClipPlayer>

/** A take's waveform, with the seam of a loop marked. */
export function Wave({ peaks, loop }: { peaks: number[]; loop: boolean }) {
  return (
    <div className="wave" aria-hidden>
      {peaks.map((peak, i) => (
        <i key={i} style={{ height: `${Math.max(4, peak * 100)}%` }} />
      ))}
      {loop && <span className="seam" />}
    </div>
  )
}

/**
 * What the game plays for a track, on its own above the takes: the chosen take, else the game's
 * own file, else nothing. A chosen take can be un-chosen, after a question, since that deletes its
 * music file from the game; the game's own file never can.
 */
export function InTheGame({
  track,
  view,
  player,
}: {
  track: TrackRow
  view: MusicTakesView
  player: Player
}) {
  const state = inTheGame(track)
  const take = view.takes.find((t) => t.chosen)
  const unchoose = useUnchooseTake(track.id)
  const choose = useChooseTake(track.id)
  const [asking, setAsking] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const block = useRef<HTMLElement | null>(null)
  const refocus = useFocusWhenClosed(asking, opener)
  const focusBlock = useFocusWhenClosed(asking, block)

  if (asking && state.kind === 'take') {
    const cancel = () => {
      refocus()
      setAsking(false)
    }
    return (
      <div
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'Escape' && !unchoose.isPending) cancel()
        }}
      >
        <Confirm
          title={`Un-choose Take ${state.take}?`}
          effects={[]}
          note={unchooseQuestion(state.take, track.gameFile?.file ?? null)}
          back="Cancel"
          backDisabled={unchoose.isPending}
          onBack={cancel}
        >
          <button
            className="btn btn-primary"
            type="button"
            autoFocus
            disabled={unchoose.isPending}
            onClick={() =>
              unchoose.mutate(undefined, {
                onSuccess: (result) => {
                  setAsking(false)
                  if (result.ok) focusBlock()
                  else refocus()
                },
                // The question was refused by the server or never got there: the block stays.
                onError: () => {
                  setAsking(false)
                  refocus()
                },
              })
            }
          >
            {unchoose.isPending ? 'Un-choosing…' : 'Un-choose'}
          </button>
        </Confirm>
      </div>
    )
  }

  const failed = unchoose.data && !unchoose.data.ok ? unchoose.data : null
  const failedLine =
    state.kind === 'take' && (failed || unchoose.isError)
      ? unchooseFailure(
          state.take,
          failed && 'message' in failed
            ? failed.message.replace(/\.$/, '')
            : unchoose.isError && !failed
              ? unchoose.error.message
              : 'the music lock could not be read',
        )
      : null
  const cls =
    state.kind === 'nothing'
      ? 'track-in-game track-in-game-none'
      : (state.kind === 'take' && state.missing) || (state.kind === 'game' && !state.exists)
        ? 'track-in-game track-in-game-warn'
        : 'track-in-game'
  const label = <span className="track-in-game-label">In the game</span>
  const hint = <span className="faint small">{state.hint}</span>

  if (state.kind === 'nothing')
    return (
      <section className={cls} aria-label="In the game" ref={block} tabIndex={-1}>
        {label}
        <b>Nothing plays here yet</b>
        {hint}
      </section>
    )

  if (state.kind === 'game') {
    const id = `music-game-${track.id}`
    const playing = player.playing === id
    return (
      <section className={cls} aria-label="In the game" ref={block} tabIndex={-1}>
        {label}
        <div className="take-row">
          {state.exists && (
            <button
              type="button"
              className="play"
              aria-label={`${playing ? 'Stop' : 'Play'} the game's own file`}
              onClick={() =>
                player.toggle(id, `/api/music/tracks/${encodeURIComponent(track.id)}/current`)
              }
            >
              {playing ? '■' : '▶'}
            </button>
          )}
          <div className="grow">
            <b>The game's own file</b>
            <div className="mono muted small">{state.file}</div>
          </div>
        </div>
        {!state.exists && <span className="small">The file is not there.</span>}
        {hint}
      </section>
    )
  }

  return (
    <section className={cls} aria-label="In the game" ref={block} tabIndex={-1}>
      <div className="take-row">
        {label}
        <b>Take {state.take}</b>
        {state.missing ? (
          <span className="chip chip-warn">music file missing</span>
        ) : (
          <span className="chip chip-ok">chosen</span>
        )}
        {take && <span className="faint small">{take.model}</span>}
      </div>
      {take && <Playback trackId={track.id} kind={view.kind} take={take} player={player} />}
      <div className="track-in-game-actions">
        <span className="grow" />
        <button
          type="button"
          className="btn btn-small"
          ref={opener}
          disabled={unchoose.isPending}
          onClick={() => {
            unchoose.reset()
            setAsking(true)
          }}
        >
          Un-choose
        </button>
        {state.missing && take && (
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={choose.isPending}
            onClick={() => choose.mutate(take.file)}
          >
            {choose.isPending ? 'Choosing…' : 'Choose again'}
          </button>
        )}
      </div>
      {hint}
      {failedLine && <span className="adopt-error">{failedLine}</span>}
      {choose.data && !choose.data.ok && (
        <span className="adopt-error">
          {'message' in choose.data ? choose.data.message : 'The take could not be chosen.'}
        </span>
      )}
      {choose.isError && <span className="adopt-error">{choose.error.message}</span>}
    </section>
  )
}

/** The chosen take's play button, waveform, length and, for a loop, Hear the seam. */
function Playback({
  trackId,
  kind,
  take,
  player,
}: {
  trackId: string
  kind: MusicTakesView['kind']
  take: TakeView
  player: Player
}) {
  const id = `music-take-${trackId}-${take.n}`
  const url = `/api/music/tracks/${encodeURIComponent(trackId)}/takes/${take.file}`
  const seamId = `${id}-seam`
  const playing = player.playing === id
  return (
    <div className="take-row">
      <button
        type="button"
        className="play"
        aria-label={`${playing ? 'Stop' : 'Play'} take ${take.n}`}
        onClick={() => player.toggle(id, url)}
      >
        {playing ? '■' : '▶'}
      </button>
      <Wave peaks={take.peaks} loop={kind === 'loop'} />
      <span className="faint small">{clock(take.seconds)}</span>
      {kind === 'loop' && (
        <button
          type="button"
          className="btn btn-small"
          onClick={() => player.toggle(seamId, `${url}?seam=1`)}
        >
          {player.playing === seamId ? 'Stop' : 'Hear the seam'}
        </button>
      )}
    </div>
  )
}
