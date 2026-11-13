import { EFFECTS_LOCK_UNREAD, EFFECTS_PENDING, effectFadesOpenWhy } from '../../effectsText'
import { off } from '../../off'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { effectSeconds, type EffectRow } from '../../../core/effects'
import {
  effectFadable,
  effectFadesOf,
  effectInTheGame,
  effectQuietLine,
  effectTakeChoosable,
  effectTakeKind,
  effectTakeLength,
  effectUnchooseQuestion,
  type EffectTakesView,
  type EffectTakeView,
} from '../../../core/effectTakes'
import { fadesLine, heardAs } from '../../../core/fades'
import { unchooseFailure } from '../../../core/musicChoose'
import { useChooseEffectTake, useUnchooseEffect } from '../../api'
import { Confirm } from '../../components/Confirm'
import type { useClipPlayer } from '../../components/useClipPlayer'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { takePlayId, takeUrl } from '../../effectsPlay'
import { Wave } from '../music/InTheGame'
import { cutShares, wavePosition } from '../music/trimSilence'
import { EffectFadesEditor } from './EffectFadesEditor'
import { useTrackActions } from '../../trackActions'
import { EffectTrimmedTag, useEffectTrimControl } from './effectTrim'

/** One clip at a time, shared with the takes below. */
export type Player = ReturnType<typeof useClipPlayer>

/**
 * What the game plays for an effect, on its own above the takes: the chosen take, else nothing.
 * Un-choosing asks first, since it deletes the take's clip from the game.
 */
export function EffectInTheGame({
  row,
  view,
  player,
  fading,
  onFades,
  onFadesClosed,
  fadesOpener,
}: {
  row: EffectRow
  view: EffectTakesView
  player: Player
  /** The take whose fades are open, if any. */
  fading: number | null
  onFades: (n: number) => void
  onFadesClosed: (n: number) => void
  /** Hands a take's Fades… button to the panel, to give it focus back when the editor closes. */
  fadesOpener: (n: number) => (button: HTMLButtonElement | null) => void
}) {
  const state = effectInTheGame(row.current)
  const take = view.takes.find((t) => t.chosen)
  const unchoose = useUnchooseEffect(row.id)
  const choose = useChooseEffectTake(row.id)
  const actions = useTrackActions()
  const trimControl = useEffectTrimControl({
    effect: row.id,
    take,
    inGame: true,
    locked: view.lockUnread,
    onPress: () => {
      if (take && player.playing === takePlayId(row.id, take.n)) player.stop()
    },
  })
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
            {...off(unchoose.isPending && EFFECTS_PENDING)}
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
    actions.shows('unchoose') &&
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
  // The chosen take's fade editor is open: it stands in for the buttons and the line naming them.
  const editing = take !== undefined && fading === take.n
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
        {take && <EffectTrimmedTag take={take} />}
        {state.missing ? (
          <span className="chip chip-warn">clip missing</span>
        ) : (
          <span className="chip chip-ok">chosen</span>
        )}
        {editing && <span className="chip chip-fade">fading</span>}
        {take && <KindChip take={take} effectLoops={row.loops} />}
        {take && <span className="faint small">{take.model}</span>}
      </div>
      {take && editing ? (
        <EffectFadesEditor
          effect={row.id}
          take={take}
          chosen
          player={player}
          onClose={() => onFadesClosed(take.n)}
          onSaved={() => {
            if (!trimControl.pending) actions.press(`fades:${take?.n}`)
          }}
        />
      ) : (
        take && (
          <>
            <Playback
              effect={row.id}
              effectLoops={row.loops}
              take={take}
              player={player}
              note={trimControl.note}
            />
            {effectFadesOf(take, row.loops) && (
              <span className="faint small">{fadesLine(effectFadesOf(take, row.loops)!)}</span>
            )}
          </>
        )
      )}
      {!editing && (
        <div className="track-in-game-actions">
          {trimControl.button}
          {take && effectFadable(take, row.loops) && (
            <button
              type="button"
              className="btn btn-small"
              ref={fadesOpener(take.n)}
              {...off(
                view.lockUnread && EFFECTS_LOCK_UNREAD,
                fading !== null && effectFadesOpenWhy(fading),
              )}
              onClick={() => {
                if (player.playing === takePlayId(row.id, take.n)) player.stop()
                onFades(take.n)
              }}
            >
              Fades…
            </button>
          )}
          {take?.loops && <HearTheSeam effect={row.id} take={take} player={player} />}
          <span className="grow" />
          <button
            type="button"
            className="btn btn-small"
            ref={opener}
            {...off(unchoose.isPending && EFFECTS_PENDING)}
            onClick={() => {
              unchoose.reset()
              actions.press('unchoose')
              setAsked(state.take)
              setAsking(true)
            }}
          >
            Un-choose
          </button>
          {state.missing && take && effectTakeChoosable(take, row.loops) && (
            <button
              type="button"
              className="btn btn-primary btn-small"
              {...off(choose.isPending && EFFECTS_PENDING)}
              onClick={() => {
                actions.press(`choose:${take.n}`)
                choose.mutate(take.file)
              }}
            >
              {choose.isPending ? 'Choosing…' : 'Choose again'}
            </button>
          )}
        </div>
      )}
      {!editing && trimControl.failure}
      {!editing && hint}
      {failedLine && <span className="adopt-error">{failedLine}</span>}
      {take &&
        actions.shows(`choose:${take.n}`) &&
        (choose.isError || (choose.data && !choose.data.ok)) && (
          <span className="adopt-error">The take could not be chosen.</span>
        )}
    </section>
  )
}

/** "made to play once" or "made to loop" beside a take made the other way from how the effect plays now. */
export function KindChip({ take, effectLoops }: { take: EffectTakeView; effectLoops: boolean }) {
  const kind = effectTakeKind(take, effectLoops)
  return kind ? <span className="chip">{kind}</span> : null
}

/** Plays the last seconds of a looping take and then its first, as the game comes round. */
export function HearTheSeam({
  effect,
  take,
  player,
}: {
  effect: string
  take: EffectTakeView
  player: Player
}) {
  const seamId = `${takePlayId(effect, take.n)}-seam`
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={() => player.toggle(seamId, `${takeUrl(effect, { file: take.file })}?seam=1`, {})}
    >
      {player.playing === seamId ? 'Stop' : 'Hear the seam'}
    </button>
  )
}

/**
 * A take's play button, waveform (with a line where it plays, the seam of a loop marked and the
 * quiet part of one that ends early shaded) and length; a loop plays round until stopped, and says
 * where it goes quiet.
 */
export function Playback({
  effect,
  effectLoops,
  take,
  player,
  note,
}: {
  effect: string
  /** How the effect plays now: a take's saved fades count only while it plays once. */
  effectLoops: boolean
  take: EffectTakeView
  player: Player
  /** The line under the waveform (what a trim cut, or why Trim silence is greyed out), if any. */
  note?: ReactNode
}) {
  const id = takePlayId(effect, take.n)
  const fades = effectFadesOf(take, effectLoops)
  const heard = heardAs(takeUrl(effect, take), fades)
  const playing = player.playing === id
  const quiet = take.quietAt !== null ? 1 - take.quietAt / take.seconds : undefined
  return (
    <>
      <div className="take-row">
        <button
          type="button"
          className="play"
          aria-label={`${playing ? 'Stop' : 'Play'} take ${take.n}`}
          onClick={() => player.toggle(id, heard.url, take.loops ? { loop: true } : {})}
        >
          {playing ? '■' : '▶'}
        </button>
        <Wave
          peaks={take.peaks}
          loop={take.loops}
          quiet={quiet}
          cut={cutShares(take)}
          position={playing ? wavePosition(take, player.position) : undefined}
          fades={
            fades ? { fades, seconds: take.trim ? take.trim.seconds : take.seconds } : undefined
          }
        />
        <span className="faint small">
          {take.loops
            ? effectSeconds(take.seconds)
            : effectTakeLength(take.trim ? take.trim.seconds : take.seconds)}
        </span>
      </div>
      {note}
      {take.quietAt !== null && <span className="take-quiet">{effectQuietLine(take.quietAt)}</span>}
    </>
  )
}
