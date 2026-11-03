import { useRef, useState, type KeyboardEvent } from 'react'
import type { EffectRow } from '../../../core/effects'
import {
  effectInTheGame,
  effectTakeLength,
  effectUnchooseQuestion,
  type EffectTakesView,
  type EffectTakeView,
} from '../../../core/effectTakes'
import { unchooseFailure } from '../../../core/musicChoose'
import { useChooseEffectTake, useUnchooseEffect } from '../../api'
import { Confirm } from '../../components/Confirm'
import type { useClipPlayer } from '../../components/useClipPlayer'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { Wave } from '../music/InTheGame'

/** One clip at a time, shared with the takes below. */
export type Player = ReturnType<typeof useClipPlayer>

/** The id a take's play button is known by to the player. */
export const takePlayId = (effect: string, n: number) => `effect-take-${effect}-${n}`

/** Where a take's sound is served from. */
export const takeUrl = (effect: string, file: string) =>
  `/api/effects/${encodeURIComponent(effect)}/takes/${encodeURIComponent(file)}`

/**
 * What the game plays for an effect, on its own above the takes: the chosen take, else nothing.
 * Un-choosing asks first, since it deletes the take's clip from the game.
 */
export function EffectInTheGame({
  row,
  view,
  player,
}: {
  row: EffectRow
  view: EffectTakesView
  player: Player
}) {
  const state = effectInTheGame(row.current)
  const take = view.takes.find((t) => t.chosen)
  const unchoose = useUnchooseEffect(row.id)
  const choose = useChooseEffectTake(row.id)
  const [asking, setAsking] = useState(false)
  // The take the question was about: a refusal is still named after the page re-reads.
  const [asked, setAsked] = useState<number | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const block = useRef<HTMLElement | null>(null)
  // Back to the block's Un-choose, or to the block when a re-read has taken that away.
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
          note={effectUnchooseQuestion(state.take)}
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
      : state.kind === 'unknown' || (state.kind === 'take' && state.missing)
        ? 'track-in-game track-in-game-warn'
        : 'track-in-game'
  const label = <span className="track-in-game-label">In the game</span>
  const hint = <span className="faint small">{state.hint}</span>

  if (state.kind === 'nothing') {
    return (
      <section className={cls} aria-label="In the game" ref={block} tabIndex={-1}>
        {label}
        <b>Nothing plays here yet</b>
        {hint}
      </section>
    )
  }

  if (state.kind === 'unknown') {
    return (
      <section className={cls} aria-label="In the game" ref={block} tabIndex={-1}>
        {label}
        <b>The sound effects lock could not be read</b>
        {hint}
        {failedLine && <span className="adopt-error">{failedLine}</span>}
      </section>
    )
  }

  return (
    <section className={cls} aria-label="In the game" ref={block} tabIndex={-1}>
      <div className="take-row">
        {label}
        <b>Take {state.take}</b>
        {state.missing ? (
          <span className="chip chip-warn">clip missing</span>
        ) : (
          <span className="chip chip-ok">chosen</span>
        )}
        {take && <span className="faint small">{take.model}</span>}
      </div>
      {take && <Playback effect={row.id} take={take} player={player} />}
      <div className="track-in-game-actions">
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
      {hint}
      {failedLine && <span className="adopt-error">{failedLine}</span>}
      {choose.data && !choose.data.ok && (
        <span className="adopt-error">The take could not be chosen.</span>
      )}
      {choose.isError && <span className="adopt-error">The take could not be chosen.</span>}
    </section>
  )
}

/** A take's play button, waveform (with a line where it plays) and length. */
export function Playback({
  effect,
  take,
  player,
}: {
  effect: string
  take: EffectTakeView
  player: Player
}) {
  const id = takePlayId(effect, take.n)
  const playing = player.playing === id
  return (
    <div className="take-row">
      <button
        type="button"
        className="play"
        aria-label={`${playing ? 'Stop' : 'Play'} take ${take.n}`}
        onClick={() => player.toggle(id, takeUrl(effect, take.file), { fade: true })}
      >
        {playing ? '■' : '▶'}
      </button>
      <Wave peaks={take.peaks} loop={false} position={playing ? player.position : undefined} />
      <span className="faint small">{effectTakeLength(take.seconds)}</span>
    </div>
  )
}
