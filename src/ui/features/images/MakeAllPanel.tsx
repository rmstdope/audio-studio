import { useEffect, useRef, useState, type ReactNode } from 'react'
import { imageModel } from '../../../core/imageModels'
import type { ImagesAct } from '../../../core/images'
import { planImagesMakeAll, TAKES_EACH } from '../../../core/imagesMakeAll'
import {
  useImageMaking,
  useImageModelState,
  useImagesBatch,
  useImagesMakeAll,
  useImagesStopAll,
} from '../../api'
import {
  busyLine,
  chosenLine,
  disagreeLine,
  makeAllHeading,
  makeAllLine,
  nothingToMakeDisagreeLine,
  readyLine,
  runningLine,
  summaryFailed,
  summaryLead,
  summaryStopped,
} from '../../imagesMakeAllText'
import { listSeparator } from '../../imagesText'
import { useStopFocus } from '../../components/useStopFocus'
import { routeHref } from '../../route'

/** What focus goes to once the panel has re-rendered after a press. */
type Focus = 'button' | 'make' | 'stop' | 'close' | null

/**
 * The action of the "Images up to date" panel on an act: a button that makes four takes for every
 * image with no chosen take, after a question in the panel; while anything in the act is being
 * made, what is being made and Stop all; when the last take is done, a summary until Close. The
 * `children` (the panel's count) sit on its left.
 */
export function MakeAllPanel({ act, children }: { act: ImagesAct; children: ReactNode }) {
  const making = useImageMaking().data ?? {}
  const state = useImageModelState().data
  const make = useImagesMakeAll(act.id)
  const stop = useImagesStopAll(act.id)
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState<Focus>(null)
  const closing = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const makeButton = useRef<HTMLButtonElement>(null)
  const stopButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  const ids = new Set(act.order)
  const mine = Object.entries(making).filter(([id]) => ids.has(id))
  const running = {
    takes: mine.reduce((sum, [, m]) => sum + m.takes, 0),
    images: mine.filter(([, m]) => m.takes > 0).length,
    left: mine.reduce((sum, [, m]) => sum + (m.takes > 0 ? m.left : 0), 0),
  }
  // Takes started elsewhere give the question way; it does not come back when they are done.
  const busyNow = running.takes > 0
  const { batch, dismiss } = useImagesBatch(act.id, busyNow)
  // Focus moves after the render that shows its target.
  useEffect(() => {
    if (!focus) return
    // After Close the summary may still be drawn for a moment; focus waits for what replaces it.
    if (focus === 'button' && closing.current && batch) return
    const target = { button, make: makeButton, stop: stopButton, close: closeButton }[focus].current
    if (target) target.focus()
    else panel.current?.focus()
    closing.current = false
    setFocus(null)
  }, [focus, batch])
  const stopFocus = useStopFocus(busyNow, () => setFocus(batch ? 'close' : 'button'))
  const { reset: resetStop } = stop
  useEffect(() => {
    if (!busyNow) resetStop()
  }, [busyNow, resetStop])
  useEffect(() => {
    if (busyNow) setOpen(false)
  }, [busyNow])
  const plan =
    state && 'states' in state
      ? planImagesMakeAll({
          rows: act.rows,
          conflicts: act.conflicts,
          making,
          main: state.main,
          states: state.states,
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
        <span role="status">{runningLine(running)}</span>
        <button
          ref={stopButton}
          type="button"
          className="btn btn-ghost"
          aria-disabled={stop.isPending || undefined}
          onClick={() => !stop.isPending && stop.mutate()}
          {...stopFocus}
        >
          Stop all
        </button>
      </div>
    )
  } else if (batch && !batch.running) {
    const failedImages = act.rows.filter(
      (r) =>
        batch.images.includes(r.id) &&
        (making[r.id]?.failed ?? 0) > (batch.failedBefore[r.id] ?? 0),
    )
    const failed = failedImages.reduce(
      (sum, r) => sum + (making[r.id]!.failed - (batch.failedBefore[r.id] ?? 0)),
      0,
    )
    const stopped = batch.images.reduce(
      (sum, id) => sum + Math.max(0, (making[id]?.stopped ?? 0) - (batch.stoppedBefore[id] ?? 0)),
      0,
    )
    const made = Math.max(0, batch.total - failed - stopped)
    const words = summaryFailed(
      failed,
      failedImages.map((r) => r.title),
    )
    action = (
      <div className="make-all-line">
        <span role="status">
          {summaryLead(batch.total, made)}
          {failed > 0 && (
            <>
              {' '}
              {words.before}
              {failedImages.map((r, i) => (
                <span key={r.id}>
                  {listSeparator(i, failedImages.length)}
                  <a href={routeHref({ view: 'images', page: 'image', image: r.id, from: act.id })}>
                    {r.title}
                  </a>
                </span>
              ))}
              {words.after}
            </>
          )}
          {stopped > 0 && ` ${summaryStopped(stopped)}`}
        </span>
        <button
          ref={closeButton}
          type="button"
          className="btn"
          onClick={() => {
            closing.current = true
            dismiss()
            setFocus('button')
          }}
        >
          Close
        </button>
      </div>
    )
  } else if (plan?.kind === 'all-chosen') {
    action = (
      <span className="muted">
        {act.conflicts.length > 0
          ? nothingToMakeDisagreeLine(act.conflicts.map((c) => c.title))
          : 'Every image has a chosen take.'}
      </span>
    )
  } else if (plan?.kind === 'not-ready') {
    action = (
      <div className="make-all-line">
        <span className="muted">Images can&apos;t be made yet. Setup says what is missing.</span>
        {setup}
      </div>
    )
  } else if (plan?.kind === 'ready') {
    action = (
      <div className="make-all-line">
        <span className="muted">{readyLine(plan.images.length)}</span>
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
  if (open && running.takes === 0 && plan?.kind === 'ready' && state && 'main' in state) {
    const heading = makeAllHeading(plan.takes, plan.images.length)
    question = (
      <section
        className="make-all-question"
        aria-label={heading}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel()
        }}
      >
        <h3>{heading}</h3>
        <span className="muted">
          {makeAllLine({
            model: imageModel(plan.model).short,
            main: imageModel(state.main).short,
            why: plan.why,
            seconds: plan.seconds,
          })}
        </span>
        <ul>
          {plan.images.map((r) => (
            <li key={r.id}>{r.title}</li>
          ))}
        </ul>
        {plan.chosen.length > 0 && (
          <span className="muted small">{chosenLine(plan.chosen.map((r) => r.title))}</span>
        )}
        {plan.busy.length > 0 && (
          <span className="muted small">{busyLine(plan.busy.map((r) => r.title))}</span>
        )}
        {plan.disagree.length > 0 && (
          <span className="muted small">{disagreeLine(plan.disagree.map((c) => c.title))}</span>
        )}
        <div className="make-all-buttons">
          <button
            ref={makeButton}
            type="button"
            className="btn btn-primary"
            disabled={make.isPending}
            onClick={() =>
              make.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false)
                  setFocus('stop')
                },
                onError: () => {
                  setOpen(false)
                  setFocus('button')
                },
              })
            }
          >
            {`Make ${plan.takes} takes`}
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
      {stop.isError && busyNow && (
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
