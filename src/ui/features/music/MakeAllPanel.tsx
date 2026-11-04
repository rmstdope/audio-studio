import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MusicListSummary } from '../../../core/music'
import { planMakeAll, TAKES_EACH } from '../../../core/musicMakeAll'
import { musicModel, type MusicModelId } from '../../../core/musicModels'
import {
  useMakeAll,
  useMakeAllBatch,
  useMusicMaking,
  useMusicModelState,
  useStopAll,
} from '../../api'
import {
  busyLine,
  chosenLine,
  joinSeparators,
  makeAllButton,
  makeAllHeading,
  makeAllLine,
  nonePossibleLine,
  readyLine,
  runningLine,
  summaryFailed,
  summaryLead,
  summaryStopped,
  tooLongLine,
} from '../../musicMakeAllText'
import { routeHref } from '../../route'

/** What focus goes to once the panel has re-rendered after a press. */
type Focus = 'button' | 'make' | 'stop' | null

/**
 * The action of the "Tracks up to date" panel on a list: a button that makes four takes for every
 * track with no chosen take, after a question in the panel; while anything in the list is being
 * made, what is being made and Stop all; when the last take is done, a summary until Close. The
 * `children` (the panel's count) sit on its left.
 */
export function MakeAllPanel({ list, children }: { list: MusicListSummary; children: ReactNode }) {
  const making = useMusicMaking().data ?? {}
  const state = useMusicModelState().data
  const { batch, dismiss } = useMakeAllBatch(list.id)
  const make = useMakeAll(list.id)
  const stop = useStopAll(list.id)
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState<Focus>(null)
  const panel = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const makeButton = useRef<HTMLButtonElement>(null)
  const stopButton = useRef<HTMLButtonElement>(null)
  // Focus moves after the render that shows its target.
  useEffect(() => {
    if (!focus) return
    const target = { button, make: makeButton, stop: stopButton }[focus].current
    if (target) target.focus()
    else if (focus === 'button') panel.current?.focus()
    setFocus(null)
  }, [focus])

  const ids = new Set(list.tracks.map((t) => t.id))
  const mine = Object.entries(making).filter(([id]) => ids.has(id))
  const running = {
    takes: mine.reduce((sum, [, m]) => sum + m.takes, 0),
    tracks: mine.filter(([, m]) => m.takes > 0).length,
    left: mine.reduce((sum, [, m]) => sum + m.left, 0),
  }
  const paid = state?.ok && musicModel(state.model).perMinute !== null
  const plan = state?.ok
    ? planMakeAll({
        kind: list.kind === 'stingers' ? 'stinger' : 'loop',
        tracks: list.tracks,
        making,
        model: state.model as MusicModelId,
        ready: state.ready,
      })
    : null
  const setup = (
    <a className="btn" href={routeHref({ view: 'setup' })}>
      Open Setup
    </a>
  )

  let action: ReactNode = null
  if (running.takes > 0) {
    action = (
      <div className="make-all-line">
        <span>{runningLine(running)}</span>
        <button
          ref={stopButton}
          type="button"
          className="btn btn-ghost"
          disabled={stop.isPending}
          title={
            paid
              ? 'ElevenLabs may still bill a take that is stopped while it is being made.'
              : undefined
          }
          onClick={() => stop.mutate()}
        >
          Stop all
        </button>
      </div>
    )
  } else if (batch) {
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
          type="button"
          className="btn"
          onClick={() => {
            dismiss()
            setFocus('button')
          }}
        >
          Close
        </button>
      </div>
    )
  } else if (plan?.kind === 'all-chosen') {
    action = <span className="muted">Every track has a chosen take.</span>
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
        <span className="muted">{readyLine(plan.tracks.length)}</span>
        <button
          ref={button}
          type="button"
          className="btn btn-primary"
          onClick={() => {
            make.reset()
            setOpen(true)
            setFocus('make')
          }}
        >
          {`Make ${TAKES_EACH} takes each`}
        </button>
      </div>
    )
  }

  const cancel = () => {
    setOpen(false)
    setFocus('button')
  }
  let question: ReactNode = null
  if (open && running.takes === 0 && plan?.kind === 'ready' && plan.tracks.length > 0) {
    const model = musicModel((state as { model: MusicModelId }).model)
    const fromFailed = Object.fromEntries(plan.tracks.map((t) => [t.id, making[t.id]?.failed ?? 0]))
    question = (
      <section
        className="make-all-question"
        aria-label={makeAllHeading(plan.takes, plan.tracks.length)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel()
        }}
      >
        <h3>{makeAllHeading(plan.takes, plan.tracks.length)}</h3>
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
            ref={makeButton}
            type="button"
            className="btn btn-primary"
            disabled={make.isPending}
            onClick={() =>
              make.mutate(
                { tracks: plan.tracks.map((t) => t.id), failedBefore: fromFailed },
                {
                  onSuccess: () => {
                    setOpen(false)
                    setFocus('stop')
                  },
                  onError: () => {
                    setOpen(false)
                    setFocus('button')
                  },
                },
              )
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
    <div ref={panel} tabIndex={-1} className="make-all">
      <div className="status-row">
        {children}
        {action}
      </div>
      {question}
      {make.isError && (
        <p className="make-all-error" role="alert">
          The takes could not be started. Nothing was made; try again.
        </p>
      )}
    </div>
  )
}
