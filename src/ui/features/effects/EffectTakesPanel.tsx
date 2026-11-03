import { useEffect, useState } from 'react'
import type { EffectRow } from '../../../core/effects'
import {
  MAX_EFFECT_TAKES,
  effectAcceptable,
  effectChangedAdvice,
  effectChangedLine,
  effectCountEntry,
  effectTakeChoosable,
  effectTimeLeft,
  makeEffectTakesLabel,
  type EffectMakingView,
  type EffectTakeView,
} from '../../../core/effectTakes'
import {
  useAcceptEffect,
  useChooseEffectTake,
  useDropEffectTake,
  useEffectTakes,
  useMakeEffectTakes,
  useStopEffectTakes,
} from '../../api'
import { Problems } from '../../components/Problems'
import { useClipPlayer } from '../../components/useClipPlayer'
import { failureLine, progressOf } from '../../musicTakesText'
import { routeHref } from '../../route'
import { compareClips, takePlayId } from '../../effectsPlay'
import { EffectInTheGame, HearTheSeam, KindChip, Playback, type Player } from './EffectInTheGame'

/**
 * An effect's Takes panel with the boxes above it: the takes made, played alone or after the chosen
 * one; the ones being made; "Make 4 takes" (the count is the menu's: 1 to 8); and what the effect
 * plays in the game. A take that failed says why, with Try again; when no effect can be made, it
 * says why and links Setup.
 */
export function EffectTakesPanel({ row }: { row: EffectRow }) {
  const id = row.id
  const takes = useEffectTakes(id)
  const make = useMakeEffectTakes(id)
  const stop = useStopEffectTakes(id)
  const accept = useAcceptEffect(id)
  const player = useClipPlayer()
  // Which take "The chosen, then this" was pressed on; it ends with the list in turn.
  const [comparing, setComparing] = useState<number | null>(null)
  const inTurn = player.inTurn
  useEffect(() => {
    if (!inTurn) setComparing(null)
  }, [inTurn])
  // How many takes the next press makes: 4 at first, then the pick, while the page stays open.
  const [count, setCount] = useState(4)
  const view = takes.data
  if (!view) {
    return (
      <section className="panel">
        {takes.isError ? 'The takes could not be loaded.' : 'Loading takes…'}
      </section>
    )
  }
  if (!('making' in view)) {
    return <Problems title="The takes could not be listed" problems={view.problems} />
  }
  const { generator } = view
  // The chosen take is shown above, in the game's block; the cards are the others.
  const chosen = view.takes.find((take) => take.chosen)
  const others = view.takes.filter((take) => !take.chosen)
  const none = !others.length && !view.making.length
  const busy = view.making.length > 0
  const canMake = generator.ok
  const makeBatch = () => make.mutate({ count })
  const menu = (
    <select
      className="takes-count"
      aria-label="Number of new takes"
      value={count}
      disabled={busy}
      onChange={(event) => setCount(Number(event.target.value))}
    >
      {Array.from({ length: MAX_EFFECT_TAKES }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {effectCountEntry(n)}
        </option>
      ))}
    </select>
  )
  const button = (hasTakes: boolean) => (
    <button
      type="button"
      className="btn btn-primary"
      disabled={!canMake || make.isPending || busy}
      onClick={makeBatch}
    >
      {makeEffectTakesLabel(count, hasTakes)}
    </button>
  )
  const compare = (take: EffectTakeView) => {
    if (!chosen) return
    if (comparing === take.n) {
      player.stop()
      return
    }
    setComparing(take.n)
    player.playInTurn(compareClips(id, chosen, take))
  }
  const changed = row.changed
  return (
    <>
      {!generator.ok && (
        <div className="errbox" role="alert">
          <div className="errbox-text">
            <strong>Sound effects can&apos;t be made yet.</strong>
            <span className="muted small">{`${generator.message} Setup says what is missing.`}</span>
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
      {changed.length > 0 && row.current.kind === 'take' && (
        <div className="warnbox" role="status">
          <strong>{effectChangedLine(changed)}</strong>
          <span className="muted small">{effectChangedAdvice(changed)}</span>
          {effectAcceptable(changed) && (
            <div className="warnbox-actions">
              <button
                type="button"
                className="btn btn-small"
                disabled={accept.isPending}
                onClick={() => accept.mutate()}
              >
                Accept
              </button>
              {accept.data && !accept.data.ok && (
                <span className="adopt-error">
                  {'message' in accept.data
                    ? accept.data.message
                    : 'The change could not be accepted.'}
                </span>
              )}
              {accept.error && <span className="adopt-error">{accept.error.message}</span>}
            </div>
          )}
        </div>
      )}
      <EffectInTheGame row={row} view={view} player={player} />
      <section className="panel takes-panel" aria-label="Takes">
        <div className="takes-head">
          <h2>Takes</h2>
          {!none && (
            <div className="takes-controls">
              {busy && (
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
              {button(view.takes.length > 0)}
            </div>
          )}
        </div>
        {view.lockUnread && (
          <span className="takes-missing small">
            Choosing and dropping wait until the sound effects lock can be read. You can still
            listen and make more takes.
          </span>
        )}
        {none ? (
          <div className="takes-empty">
            <strong>{chosen ? 'No other takes yet' : 'No takes yet'}</strong>
            <span className="muted">
              Each take is a new sound made from the description, about 2 seconds each.
              <br />
              {chosen
                ? 'Make a few more to compare with the chosen one.'
                : 'Make a few, listen, and choose the one the game plays.'}
            </span>
            <div className="takes-make">
              {menu}
              {button(false)}
            </div>
          </div>
        ) : (
          <div className="takes">
            {others.map((take) => (
              <TakeCard
                key={take.n}
                effect={id}
                effectLoops={row.loops}
                take={take}
                player={player}
                locked={view.lockUnread}
                canCompare={Boolean(chosen)}
                comparing={comparing === take.n}
                onCompare={() => compare(take)}
              />
            ))}
            {view.making.map((making) => (
              <MakingCard key={making.n} making={making} />
            ))}
          </div>
        )}
        {make.data && !make.data.ok && 'message' in make.data && (
          <span className="adopt-error">{make.data.message}</span>
        )}
        {stop.isError && <span className="adopt-error">{stop.error.message}</span>}
        {make.isError && <span className="adopt-error">{make.error.message}</span>}
      </section>
    </>
  )
}

/** A take made: play, its waveform with a line where it plays, its length, and what can be done with it. */
function TakeCard({
  effect,
  effectLoops,
  take,
  player,
  locked,
  canCompare,
  comparing,
  onCompare,
}: {
  effect: string
  /** How the effect plays now: a take made the other way cannot be chosen. */
  effectLoops: boolean
  take: EffectTakeView
  player: Player
  /** The lock cannot be read: Choose and Drop wait. */
  locked: boolean
  /** A take is chosen, so there is something to compare with. */
  canCompare: boolean
  /** This card's comparison is playing (or in its quiet). */
  comparing: boolean
  onCompare: () => void
}) {
  const id = takePlayId(effect, take.n)
  const playing = player.playing === id
  const seamPlaying = player.playing === `${id}-seam`
  const drop = useDropEffectTake(effect)
  const choose = useChooseEffectTake(effect)
  const failedChoose = choose.isError || (choose.data && !choose.data.ok)
  const failedDrop = drop.isError || (drop.data && !drop.data.ok)
  return (
    <div className="take">
      <div className="take-row">
        <b className="grow">Take {take.n}</b>
        <KindChip take={take} effectLoops={effectLoops} />
      </div>
      <span className="faint small">{take.model}</span>
      <Playback effect={effect} take={take} player={player} />
      {(take.loops || canCompare) && (
        <div className="take-row">
          {take.loops && <HearTheSeam effect={effect} take={take} player={player} />}
          {canCompare && (
            <button type="button" className="btn btn-small" onClick={onCompare}>
              {comparing ? '■ Stop' : '▶ The chosen, then this'}
            </button>
          )}
        </div>
      )}
      <div className="take-row">
        {effectTakeChoosable(take, effectLoops) && (
          <button
            type="button"
            className="btn btn-small"
            disabled={locked || choose.isPending || drop.isPending}
            onClick={() => choose.mutate(take.file)}
          >
            {choose.isPending ? 'Choosing…' : 'Choose'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={locked || drop.isPending || choose.isPending}
          onClick={() => {
            if (playing || comparing || seamPlaying) player.stop()
            drop.mutate(take.file)
          }}
        >
          Drop
        </button>
      </div>
      {failedChoose && <span className="adopt-error">The take could not be chosen.</span>}
      {failedDrop && <span className="adopt-error">The take could not be dropped.</span>}
    </div>
  )
}

/** A take waiting or being made: a dashed card with a progress bar and the time left. */
function MakingCard({ making }: { making: EffectMakingView }) {
  return (
    <div className="take take-making">
      <div className="take-row">
        <b>Take {making.n}</b>
        <span className="small">{effectTimeLeft(making)}</span>
      </div>
      <span className="faint small">{making.model}</span>
      <div className="bar" role="progressbar" aria-label={`Take ${making.n}`}>
        <i style={{ width: `${Math.round(progressOf(making) * 100)}%` }} />
      </div>
    </div>
  )
}
