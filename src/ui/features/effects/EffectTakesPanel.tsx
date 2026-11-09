import { useEffect, useRef, useState } from 'react'
import type { EffectRow } from '../../../core/effects'
import {
  EFFECT_MODEL_IDS,
  defaultEffectModel,
  effectMenuEntry,
  effectModel,
  effectSwitchedLine,
  type EffectModelId,
  type EffectModelState,
} from '../../../core/effectModels'
import {
  MAX_EFFECT_TAKES,
  effectChipLine,
  effectAcceptable,
  effectChangedAdvice,
  effectChangedLine,
  effectCountEntry,
  effectFadable,
  effectFadesOf,
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
import { fadesLine } from '../../../core/fades'
import { Problems } from '../../components/Problems'
import { useClipPlayer } from '../../components/useClipPlayer'
import { failureLine, progressOf } from '../../musicTakesText'
import { routeHref } from '../../route'
import { compareClips, takePlayId } from '../../effectsPlay'
import { EffectFadesEditor } from './EffectFadesEditor'
import { EffectTrimmedTag, useEffectTrimControl } from './effectTrim'
import { EffectInTheGame, HearTheSeam, KindChip, Playback, type Player } from './EffectInTheGame'

/**
 * An effect's Takes panel with the boxes above it: the takes made, played alone or after the chosen
 * one; the ones being made; "Make 4 takes" (the count is the menu's: 1 to 8); and what the effect
 * plays in the game. A take that failed says why, with Try again; when no effect can be made, it
 * says why and links Setup.
 */
export function EffectTakesPanel({
  row,
  saveWords,
}: {
  row: EffectRow
  /** Sees the description's words saved: whether they were, or null with nothing to save. */
  saveWords?: () => Promise<boolean> | null
}) {
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
  // The take whose fades are open (one editor at a time), and the Fades… buttons to give focus back to.
  const [fading, setFading] = useState<number | null>(null)
  const fadeOpeners = useRef(new Map<number, HTMLButtonElement>())
  const refocusFades = useRef<number | null>(null)
  useEffect(() => {
    if (fading === null && refocusFades.current !== null) {
      fadeOpeners.current.get(refocusFades.current)?.focus()
      refocusFades.current = null
    }
  }, [fading])
  /** Closes the fades editor and returns focus to its take's Fades… button. */
  const closeFades = (n: number) => {
    refocusFades.current = n
    setFading(null)
  }
  const fadesOpener = (n: number) => (button: HTMLButtonElement | null) => {
    if (button) fadeOpeners.current.set(n, button)
    else fadeOpeners.current.delete(n)
  }
  // How many takes the next press makes: 4 at first, then the pick, while the page stays open.
  const [count, setCount] = useState(4)
  // The model the next press uses: Setup's, until a pick, which lasts while the page stays open.
  const [picked, setPicked] = useState<EffectModelId | null>(null)
  const [waitingForWords, setWaitingForWords] = useState(false)
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
  const states = Object.fromEntries(
    view.models.map(({ id, download, failed }) => [id, { download, failed }]),
  ) as Record<EffectModelId, EffectModelState>
  const fallback = defaultEffectModel(view.projectModel, states, view.uv)
  const model = picked && states[picked].download === 'whole' ? picked : fallback
  // Why new takes start on the other model, when Setup's cannot run.
  const mainState = states[view.projectModel]
  const switchedReason =
    fallback === view.projectModel
      ? null
      : mainState.download === 'absent'
        ? 'absent'
        : mainState.download === 'partial'
          ? 'partial'
          : 'failed'
  // The chosen take is shown above, in the game's block; the cards are the others.
  const chosen = view.takes.find((take) => take.chosen)
  const others = view.takes.filter((take) => !take.chosen)
  const none = !others.length && !view.making.length
  const busy = view.making.length > 0
  const canMake = view.canMake
  /** Takes are made from the saved words, so `ask` waits until they are the words in the field. */
  const afterWordsSaved = (ask: () => void) => {
    const saving = saveWords?.() ?? null
    if (saving === null) return ask()
    setWaitingForWords(true)
    void saving.then((wordsSaved) => {
      setWaitingForWords(false)
      if (wordsSaved) ask()
    })
  }
  const makeBatch = () => afterWordsSaved(() => make.mutate({ count, model }))
  const menu = (
    <>
      <select
        className="takes-model"
        aria-label="Model for new takes"
        value={model}
        disabled={busy || make.isPending || waitingForWords || !canMake}
        onChange={(event) => setPicked(event.target.value as EffectModelId)}
      >
        {EFFECT_MODEL_IDS.map((id) => (
          <option key={id} value={id} disabled={states[id].download !== 'whole'}>
            {effectMenuEntry(id, states[id])}
          </option>
        ))}
      </select>
      <select
        className="takes-count"
        aria-label="Number of new takes"
        value={count}
        disabled={busy || waitingForWords || !canMake}
        onChange={(event) => setCount(Number(event.target.value))}
      >
        {Array.from({ length: MAX_EFFECT_TAKES }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {effectCountEntry(n)}
          </option>
        ))}
      </select>
    </>
  )
  const button = (hasTakes: boolean) => (
    <button
      type="button"
      className="btn btn-primary"
      disabled={!canMake || make.isPending || busy || waitingForWords}
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
    player.playInTurn(compareClips(id, chosen, take, row.loops))
  }
  const changed = row.changed
  return (
    <>
      {!canMake && (
        <div className="errbox" role="alert">
          <div className="errbox-text">
            <strong>Sound effects can&apos;t be made yet.</strong>
            <span className="muted small">
              Neither sound-effects model can run on this computer. Setup says what is missing.
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
            disabled={make.isPending || waitingForWords || !canMake}
            onClick={() => afterWordsSaved(() => make.mutate({ retry: failed.n }))}
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
      <EffectInTheGame
        row={row}
        view={view}
        player={player}
        fading={fading}
        onFades={setFading}
        onFadesClosed={closeFades}
        fadesOpener={fadesOpener}
      />
      <section className="panel takes-panel effect-takes" aria-label="Takes">
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
        {switchedReason && canMake && (
          <span className="faint small">
            {effectSwitchedLine(view.projectModel, fallback, switchedReason)}
          </span>
        )}
        {view.lockUnread && (
          <span className="takes-missing small">
            Choosing, dropping and fading wait until the sound effects lock can be read. You can
            still listen and make more takes.
          </span>
        )}
        {none ? (
          <div className="takes-empty">
            <strong>{chosen ? 'No other takes yet' : 'No takes yet'}</strong>
            <span className="muted">
              Each take is a new sound made from the description, about {effectModel(model).seconds}{' '}
              seconds each.
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
                fading={fading}
                onFades={setFading}
                onFadesClosed={closeFades}
                fadesOpener={fadesOpener(take.n)}
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
  fading,
  onFades,
  onFadesClosed,
  fadesOpener,
}: {
  effect: string
  /** How the effect plays now: a take made the other way cannot be chosen. */
  effectLoops: boolean
  take: EffectTakeView
  player: Player
  /** The lock cannot be read: Choose, Drop and Fades… wait. */
  locked: boolean
  /** A take is chosen, so there is something to compare with. */
  canCompare: boolean
  /** This card's comparison is playing (or in its quiet). */
  comparing: boolean
  onCompare: () => void
  /** The take whose fades are open, if any. */
  fading: number | null
  onFades: (n: number) => void
  onFadesClosed: (n: number) => void
  /** Hands the Fades… button to the panel, to give it focus back when the editor closes. */
  fadesOpener: (button: HTMLButtonElement | null) => void
}) {
  const id = takePlayId(effect, take.n)
  const playing = player.playing === id
  const seamPlaying = player.playing === `${id}-seam`
  const drop = useDropEffectTake(effect)
  const choose = useChooseEffectTake(effect)
  const trim = useEffectTrimControl({
    effect,
    take,
    inGame: false,
    locked,
    onPress: () => {
      if (playing || seamPlaying) player.stop()
    },
  })
  const failedChoose = choose.isError || (choose.data && !choose.data.ok)
  const failedDrop = drop.isError || (drop.data && !drop.data.ok)
  const editing = fading === take.n
  const otherOpen = fading !== null && !editing
  const fades = effectFadesOf(take, effectLoops)
  return (
    <div className="take">
      <div className="take-row">
        <b className="grow">Take {take.n}</b>
        {editing && <span className="chip chip-fade">fading</span>}
        <EffectTrimmedTag take={take} />
        <KindChip take={take} effectLoops={effectLoops} />
      </div>
      <span className="faint small">{take.model}</span>
      {editing ? (
        <EffectFadesEditor
          effect={effect}
          take={take}
          chosen={false}
          player={player}
          onClose={() => onFadesClosed(take.n)}
          onSaved={trim.clear}
        />
      ) : (
        <>
          <Playback
            effect={effect}
            effectLoops={effectLoops}
            take={take}
            player={player}
            note={trim.note}
          />
          {fades && <span className="faint small">{fadesLine(fades)}</span>}
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
          <div className="take-row take-actions">
            {trim.button}
            {effectFadable(take, effectLoops) && (
              <button
                type="button"
                ref={fadesOpener}
                className="btn btn-small"
                disabled={locked}
                aria-disabled={otherOpen ? true : undefined}
                title={otherOpen ? `Close the fades of Take ${fading} first.` : undefined}
                onClick={() => {
                  if (otherOpen) return
                  if (playing || comparing) player.stop()
                  onFades(take.n)
                }}
              >
                Fades…
              </button>
            )}
            <span className="grow" />
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
          </div>
          {trim.failure}
        </>
      )}
      {failedChoose && <span className="adopt-error">The take could not be chosen.</span>}
      {failedDrop && (
        <span className="adopt-error">
          {drop.data && 'message' in drop.data
            ? drop.data.message
            : 'The take could not be dropped.'}
        </span>
      )}
    </div>
  )
}

/** A take waiting or being made: a dashed card with a progress bar and the time left. */
function MakingCard({ making }: { making: EffectMakingView }) {
  const chipLine = making.chip ? effectChipLine(making.chip.using) : null
  return (
    <div className="take take-making">
      <div className="take-row">
        <b>Take {making.n}</b>
        <span className="small">{effectTimeLeft(making)}</span>
      </div>
      {chipLine && <span className="faint small">{chipLine}</span>}
      <span className="faint small">{making.model}</span>
      <div className="bar" role="progressbar" aria-label={`Take ${making.n}`}>
        <i style={{ width: `${Math.round(progressOf(making) * 100)}%` }} />
      </div>
    </div>
  )
}
