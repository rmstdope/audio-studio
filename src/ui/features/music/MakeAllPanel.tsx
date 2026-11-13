import type { ReactNode } from 'react'
import type { MusicListSummary } from '../../../core/music'
import { planMakeAll, TAKES_EACH } from '../../../core/musicMakeAll'
import { musicModel } from '../../../core/musicModels'
import {
  useMakeAll,
  useMakeAllBatch,
  useMusicMaking,
  useMusicModelState,
  useStopAll,
} from '../../api'
import {
  allChosenLine,
  busyLine,
  chosenLine,
  joinSeparators,
  makeAllButton,
  makeAllHeading,
  MAKE_BLOCKED_BY_REFRESH,
  makeAllLine,
  type Noun,
  nonePossibleLine,
  readyLine,
  runningLine,
  summaryFailed,
  summaryLead,
  summaryStopped,
  tooLongLine,
} from '../../musicMakeAllText'
import { WAIT_FOR_CHANGE } from '../../musicTakesText'
import { off } from '../../off'
import { useMakeAllPanel } from '../../components/useMakeAllPanel'
import { routeHref } from '../../route'

/**
 * The action of the "Tracks up to date" (or "Stingers up to date") panel on a list: a button that makes four takes for every
 * track with no chosen take, after a question in the panel; while anything in the list is being
 * made, what is being made and Stop all; when the last take is done, a summary until Close. The
 * `children` (the panel's count) sit on its left. `noun` is what the list calls its entries;
 * `refreshing` greys the two Make buttons while the list's refresh from the game runs.
 */
export function MakeAllPanel({
  list,
  noun = 'track',
  refreshing = false,
  children,
}: {
  list: MusicListSummary
  noun?: Noun
  refreshing?: boolean
  children: ReactNode
}) {
  const making = useMusicMaking().data ?? {}
  const state = useMusicModelState().data
  const make = useMakeAll(list.id)
  const stop = useStopAll(list.id)
  const ids = new Set(list.tracks.map((t) => t.id))
  const mine = Object.entries(making).filter(([id]) => ids.has(id))
  const running = {
    takes: mine.reduce((sum, [, m]) => sum + m.takes, 0),
    tracks: mine.filter(([, m]) => m.takes > 0).length,
    left: mine.reduce((sum, [, m]) => sum + m.left, 0),
  }
  const model = state?.ok ? musicModel(state.model) : null
  const paid = model !== null && model.perMinute !== null
  const plan =
    state?.ok && model
      ? planMakeAll({
          kind: list.kind === 'stingers' ? 'stinger' : 'loop',
          tracks: list.tracks,
          making,
          model: model.id,
          ready: state.ready,
        })
      : null
  // A question gives way to the running line when takes start elsewhere, and does not come back.
  const busy = running.takes > 0
  const { batch, dismiss } = useMakeAllBatch(list.id, busy)
  const settled = Boolean(batch && !batch.running && !busy)
  const ui = useMakeAllPanel({
    busy,
    summary: Boolean(batch),
    settled,
    resetStop: stop.reset,
  })
  const { open, setOpen, stopFocus } = ui
  const setup = (
    <a className="btn" href={routeHref({ view: 'setup' })}>
      Open Setup
    </a>
  )

  let action: ReactNode = null
  if (busy) {
    action = (
      <div className="make-all-line">
        <span>{runningLine({ ...running, noun })}</span>
        <button
          ref={ui.stopButton}
          type="button"
          className="btn btn-ghost"
          {...off(stop.isPending && WAIT_FOR_CHANGE)}
          title={
            paid && !stop.isPending
              ? 'ElevenLabs may still bill a take that is stopped while it is being made.'
              : undefined
          }
          onClick={() => stop.mutate()}
          {...stopFocus}
        >
          Stop all
        </button>
      </div>
    )
  } else if (batch && !batch.running) {
    const failedTracks = list.tracks.filter(
      (t) =>
        (making[t.id]?.failed ?? 0) - (batch.failedBefore[t.id] ?? 0) > 0 &&
        batch.tracks.includes(t.id),
    )
    const failed = failedTracks.reduce(
      (sum, t) => sum + (making[t.id]!.failed - (batch.failedBefore[t.id] ?? 0)),
      0,
    )
    const made = Math.max(0, batch.total - failed - batch.stopped)
    const words = summaryFailed(
      failed,
      failedTracks.map((t) => t.title),
    )
    const separators = joinSeparators(failedTracks.length)
    action = (
      <div className="make-all-line">
        <span role="status">
          {summaryLead(batch.total, made)}
          {failed > 0 && (
            <>
              {' '}
              {words.before}
              {failedTracks.map((t, i) => (
                <span key={t.id}>
                  {separators[i]}
                  <a href={routeHref({ view: 'music', page: 'track', track: t.id })}>{t.title}</a>
                </span>
              ))}
              {words.after}
            </>
          )}
          {batch.stopped > 0 && ` ${summaryStopped(batch.stopped)}`}
        </span>
        <button
          ref={ui.closeButton}
          type="button"
          className="btn"
          onClick={() => {
            dismiss()
            ui.closed()
          }}
        >
          Close
        </button>
      </div>
    )
  } else if (plan?.kind === 'all-chosen') {
    action = <span className="muted">{allChosenLine(noun)}</span>
  } else if (plan?.kind === 'not-ready') {
    action = (
      <div className="make-all-line">
        <span className="muted">Music can't be made yet. Setup says what is missing.</span>
        {setup}
      </div>
    )
  } else if (plan?.kind === 'none-possible') {
    action = (
      <div className="make-all-line">
        <span className="muted">{nonePossibleLine(musicModel(plan.model).name, plan.count)}</span>
        {setup}
      </div>
    )
  } else if (plan?.kind === 'ready' && plan.tracks.length > 0) {
    action = (
      <div className="make-all-line">
        <span className="muted">{readyLine(plan.tracks.length, noun)}</span>
        <button
          ref={ui.button}
          type="button"
          className="btn btn-primary"
          {...off(refreshing && MAKE_BLOCKED_BY_REFRESH)}
          onClick={() => {
            make.reset()
            setOpen(true)
            ui.goTo('make')
          }}
        >
          {`Make ${TAKES_EACH} takes each`}
        </button>
      </div>
    )
  }

  const cancel = () => {
    setOpen(false)
    ui.goTo('button')
  }
  let question: ReactNode = null
  if (open && !busy && model && plan?.kind === 'ready' && plan.tracks.length > 0) {
    question = (
      <section
        className="make-all-question"
        aria-label={makeAllHeading(plan.takes, plan.tracks.length, noun)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel()
        }}
      >
        <h3>{makeAllHeading(plan.takes, plan.tracks.length, noun)}</h3>
        <span className="muted">
          {makeAllLine({ name: model.name, paid: model.perMinute !== null, seconds: plan.seconds })}
        </span>
        <ul>
          {plan.tracks.map((t) => (
            <li key={t.id}>{t.title}</li>
          ))}
        </ul>
        {plan.chosen.length > 0 && (
          <span className="muted small">{chosenLine(plan.chosen.map((t) => t.title))}</span>
        )}
        {plan.tooLong.length > 0 && (
          <span className="muted small">
            {tooLongLine(
              plan.tooLong.map((t) => t.title),
              model.name,
            )}
          </span>
        )}
        {plan.busy.length > 0 && (
          <span className="muted small">{busyLine(plan.busy.map((t) => t.title))}</span>
        )}
        <div className="make-all-buttons">
          <button
            ref={ui.makeButton}
            type="button"
            className="btn btn-primary"
            {...off(refreshing && MAKE_BLOCKED_BY_REFRESH, make.isPending && WAIT_FOR_CHANGE)}
            onClick={() =>
              make.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false)
                  ui.goTo('stop')
                },
                onError: () => {
                  setOpen(false)
                  ui.goTo('button')
                },
              })
            }
          >
            {makeAllButton(plan.takes, plan.price)}
          </button>
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            Cancel
          </button>
        </div>
      </section>
    )
  }

  return (
    <div ref={ui.panel} tabIndex={-1} className="make-all">
      <div className="status-row">
        {children}
        {action}
      </div>
      {question}
      {stop.isError && busy && (
        <p className="make-all-error" role="alert">
          The takes could not be stopped. They are still being made; try again.
        </p>
      )}
      {make.isError && (
        <p className="make-all-error" role="alert">
          The takes could not be started. Nothing was made; try again.
        </p>
      )}
    </div>
  )
}
