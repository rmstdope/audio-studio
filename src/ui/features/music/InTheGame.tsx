import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { TrackRow } from '../../../core/music'
import { envelopePoints, fadesLine, heardAs, type Fades } from '../../../core/fades'
import { inTheGame, unchooseFailure, unchooseQuestion } from '../../../core/musicChoose'
import type { MusicTakesView, TakeView } from '../../../core/musicTake'
import { useChooseTake, useUnchooseTake } from '../../api'
import { Confirm } from '../../components/Confirm'
import { useClipPlayer } from '../../components/useClipPlayer'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import {
  cutShares,
  playedSeconds,
  takeLength,
  takeSoundUrl,
  TrimmedTag,
  useTrimControl,
  wavePosition,
} from './trimSilence'
import { movedFromLine } from '../../../core/musicMove'
import { FadesEditor } from './FadesEditor'

/** One clip at a time, shared with the takes below. */
type Player = ReturnType<typeof useClipPlayer>

/**
 * A take's waveform, with the seam of a loop marked and, while it plays, a line where it is
 * (`position`, 0 to 1, asked each frame; back at the start as a loop comes round). `quiet` shades
 * the tail where a loop's sound has stopped.
 */
export function Wave({
  peaks,
  loop,
  position,
  quiet,
  cut,
  fades,
}: {
  peaks: number[]
  loop: boolean
  position?: () => number | null
  /** The share of the waveform, from its end, where the sound has stopped (shaded), 0 to 1. */
  quiet?: number
  /** The shares of the waveform, from each end, a trim cut away (hatched and dimmed), 0 to 1. */
  cut?: { start: number; end: number } | null
  /** A stinger take's fades, of the sound that plays (the part between the cuts): the fade line is drawn over it. */
  fades?: { fades: Fades; seconds: number }
}) {
  const head = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!position) return
    let frame = 0
    const draw = () => {
      const at = position()
      if (head.current) head.current.style.left = `${(at ?? 0) * 100}%`
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [position])
  return (
    <div className="wave" aria-hidden>
      {peaks.map((peak, i) => (
        <i
          key={i}
          className={
            cut && (i < cut.start * peaks.length || i >= (1 - cut.end) * peaks.length)
              ? 'cut'
              : undefined
          }
          style={{ height: `${Math.max(4, peak * 100)}%` }}
        />
      ))}
      {cut && cut.start > 0 && (
        <span className="cutzone" style={{ left: 0, width: `${Math.round(cut.start * 100)}%` }} />
      )}
      {cut && cut.end > 0 && (
        <span className="cutzone" style={{ right: 0, width: `${Math.round(cut.end * 100)}%` }} />
      )}
      {quiet !== undefined && quiet > 0 && (
        <span className="quiet" style={{ width: `${Math.round(quiet * 100)}%` }} />
      )}
      {fades && (
        <svg
          className="env"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            left: `${(cut?.start ?? 0) * 100}%`,
            width: `${(1 - (cut?.start ?? 0) - (cut?.end ?? 0)) * 100}%`,
          }}
        >
          <polyline points={envelopePoints(fades.fades, fades.seconds)} />
        </svg>
      )}
      {loop && <span className="seam" />}
      {position && <span className="playhead" ref={head} />}
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
  fading,
  onFades,
  onFadesClosed,
  fadesOpener,
}: {
  track: TrackRow
  view: MusicTakesView
  player: Player
  /** The take whose fades are open, if any. */
  fading: number | null
  onFades: (n: number) => void
  onFadesClosed: (n: number) => void
  /** Hands a take's Fades… button to the panel, to give it focus back when the editor closes. */
  fadesOpener: (n: number) => (button: HTMLButtonElement | null) => void
}) {
  const state = inTheGame(track)
  const take = view.takes.find((t) => t.chosen)
  const unchoose = useUnchooseTake(track.id)
  const choose = useChooseTake(track.id)
  const trimControl = useTrimControl({
    trackId: track.id,
    take,
    inGame: true,
    locked: view.lockUnread,
    onPress: () => {
      if (take && player.playing === `music-take-${track.id}-${take.n}`) player.stop()
    },
  })
  const [asking, setAsking] = useState(false)
  // The take the question was about: a refusal is still named after the page re-reads and the
  // block no longer knows it (a music lock that cannot be read). The line is shown under a chosen
  // take or that unknown block only: a re-read that finds the game's own file or nothing means the
  // take is no longer chosen, so a refusal to un-choose it says nothing true.
  const [asked, setAsked] = useState<number | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const block = useRef<HTMLElement | null>(null)
  // Back to the block's Un-choose, or to the block when a re-read has taken that away (a refusal
  // for a music lock that cannot be read leaves the block not knowing which take plays).
  const back = useRef({
    get current() {
      return opener.current ?? block.current
    },
  }).current
  const refocus = useFocusWhenClosed(asking, back)
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
    asked !== null &&
    (state.kind === 'take' || state.kind === 'unknown') &&
    (failed || unchoose.isError)
      ? unchooseFailure(
          asked,
          !failed
            ? (unchoose.error?.message ?? '')
            : 'message' in failed
              ? failed.message
              : `${failed.file} could not be read`,
        )
      : null
  const cls =
    state.kind === 'nothing'
      ? 'track-in-game track-in-game-none'
      : state.kind === 'unknown' ||
          (state.kind === 'take' && state.missing) ||
          (state.kind === 'game' && !state.exists)
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

  if (state.kind === 'unknown')
    return (
      <section className={cls} aria-label="In the game" ref={block} tabIndex={-1}>
        {label}
        <b>The music lock could not be read</b>
        {hint}
        {failedLine && <span className="adopt-error">{failedLine}</span>}
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
        {take && <TrimmedTag take={take} />}
        {state.missing ? (
          <span className="chip chip-warn">music file missing</span>
        ) : (
          <span className="chip chip-ok">chosen</span>
        )}
        {take && fading === take.n && <span className="chip chip-fade">fading</span>}
        {take && <span className="faint small">{take.model}</span>}
      </div>
      {take?.movedFrom && <span className="faint small">{movedFromLine(take.movedFrom)}</span>}
      {take?.fades && fading !== take.n && (
        <span className="faint small">{fadesLine(take.fades)}</span>
      )}
      {take && fading === take.n ? (
        <FadesEditor
          trackId={track.id}
          take={take}
          chosen
          player={player}
          onClose={() => onFadesClosed(take.n)}
        />
      ) : (
        take && (
          <Playback
            trackId={track.id}
            kind={view.kind}
            take={take}
            player={player}
            note={trimControl.note}
          />
        )
      )}
      {!(take && fading === take.n) && (
        <div className="track-in-game-actions">
          {trimControl.button}
          {take && view.kind === 'stinger' && (
            <button
              type="button"
              className="btn btn-small"
              ref={fadesOpener(take.n)}
              aria-disabled={fading !== null && fading !== take.n ? true : undefined}
              title={
                fading !== null && fading !== take.n
                  ? `Close the fades of Take ${fading} first.`
                  : undefined
              }
              onClick={() => {
                if (fading !== null) return
                if (player.playing === `music-take-${track.id}-${take.n}`) player.stop()
                onFades(take.n)
              }}
            >
              Fades…
            </button>
          )}
          <span className="grow" />
          <button
            type="button"
            className="btn btn-small"
            ref={opener}
            disabled={unchoose.isPending}
            onClick={() => {
              unchoose.reset()
              setAsked(state.take)
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
      )}
      {hint}
      {trimControl.failure}
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
  note,
}: {
  trackId: string
  kind: MusicTakesView['kind']
  take: TakeView
  player: Player
  /** The line under the waveform (what a trim cut), if any. */
  note: ReactNode
}) {
  const id = `music-take-${trackId}-${take.n}`
  const url = takeSoundUrl(trackId, take)
  const heard = heardAs(url, take.fades)
  const seamId = `${id}-seam`
  const playing = player.playing === id
  return (
    <>
      <div className="take-row">
        <button
          type="button"
          className="play"
          aria-label={`${playing ? 'Stop' : 'Play'} take ${take.n}`}
          onClick={() => player.toggle(id, heard.url, { fade: heard.fade, loop: kind === 'loop' })}
        >
          {playing ? '■' : '▶'}
        </button>
        <Wave
          peaks={take.peaks}
          loop={kind === 'loop'}
          cut={cutShares(take)}
          position={playing ? wavePosition(take, player.position) : undefined}
          fades={take.fades ? { fades: take.fades, seconds: playedSeconds(take) } : undefined}
        />
        <span className="faint small">{takeLength(take)}</span>
        {kind === 'loop' && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => player.toggle(seamId, `${url}?seam=1`, { fade: true })}
          >
            {player.playing === seamId ? 'Stop' : 'Hear the seam'}
          </button>
        )}
      </div>
      {note}
    </>
  )
}
