import { useEffect, useRef, useState } from 'react'
import type { EffectsSummary } from '../../../core/effects'
import {
  defaultEffectModel,
  type EffectModelId,
  type EffectModelState,
} from '../../../core/effectModels'
import {
  EFFECTS_MAKE_ALL_FAILED,
  EFFECTS_STOP_FAILED,
  MAKE_ALL_TAKES,
  batchSummary,
  leftOutLines,
  makeAllButton,
  makeAllHeading,
  makeAllLine,
  makeAllModelLine,
  planMakeAll,
  runningLine,
} from '../../../core/effectsMakeAll'
import {
  useEffectModels,
  useEffectsBatch,
  useEffectsMaking,
  useMakeAllEffects,
  useStopAllEffects,
} from '../../api'
import { useStopFocus } from '../../components/useStopFocus'
import { useFocusWhenClosed } from '../../components/useFocusWhenClosed'
import { routeHref } from '../../route'
import { useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * The panel's action on the Sound effects list: how many effects have no chosen take and a button
 * that asks before it makes four takes for each; while takes are made, what is running with Stop
 * all; then how it went, until Close. Nothing starts without the question's Make.
 */
export function EffectsMakeAll({ effects }: { effects: EffectsSummary }) {
  const client = useQueryClient()
  const making = useEffectsMaking().data ?? {}
  const models = useEffectModels().data
  const running = Object.keys(making).length > 0
  const batch = useEffectsBatch(running).data
  const make = useMakeAllEffects()
  const stopAll = useStopAllEffects()
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const makeButton = useRef<HTMLButtonElement | null>(null)
  const stopButton = useRef<HTMLButtonElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const focusStop = useRef(false)
  const refocus = useFocusWhenClosed(asking, opener)
  // The summary is wanted once this page has seen the press's takes being made; the client lives
  // until the page is reloaded, so a reload ends it, and so does Close.
  const wanted = useQuery({
    queryKey: ['effects-summary-open'],
    // A refetch of everything (Setup's saves do that) keeps what the page already holds.
    queryFn: () => client.getQueryData<boolean>(['effects-summary-open']) ?? false,
    initialData: false,
    staleTime: Infinity,
  }).data
  const seen = Boolean(batch?.running)
  useEffect(() => {
    if (seen) client.setQueryData(['effects-summary-open'], true)
  }, [seen, client])
  useEffect(() => {
    // Takes started elsewhere take the question's place; it does not come back by itself.
    if (running) setAsking(false)
  }, [running])
  const finished = Boolean(batch && !batch.running && !running)
  useEffect(() => {
    // The press ended before the running line was ever drawn: nothing is left to focus.
    if (finished) focusStop.current = false
  }, [finished])
  useEffect(() => {
    if (running && focusStop.current && stopButton.current) {
      focusStop.current = false
      stopButton.current.focus()
    }
  })
  // Where focus goes when Stop all goes away: the summary's Close, else the panel's button or the panel.
  const stopFocus = useStopFocus(running, () => {
    if (closeButton.current) closeButton.current.focus()
    else if (makeButton.current) makeButton.current.focus()
    else document.querySelector<HTMLElement>('.status-panel')?.focus()
  })
  const { reset: resetStop } = stopAll
  useEffect(() => {
    if (!running) resetStop()
  }, [running, resetStop])
  const plan = planMakeAll(effects.rows, making)
  if (plan.lockUnread) return null
  const names = Object.fromEntries(effects.rows.map((row) => [row.id, row.name]))
  const summary = wanted && batch && !batch.running && !running ? batchSummary(batch) : null
  const close = () => {
    client.setQueryData(['effects-summary-open'], false)
    if (makeButton.current) makeButton.current.focus()
    else document.querySelector<HTMLElement>('.status-panel')?.focus()
  }
  const summaryLine = summary && (
    <p className="make-all-summary" role="status">
      <span>
        {summary.before}
        {summary.failed.map((id, i) => (
          <span key={id}>
            {i > 0 && (i === summary.failed.length - 1 ? ' and ' : ', ')}
            <a href={routeHref({ view: 'effects', page: 'effect', effect: id })}>
              {names[id] ?? id}
            </a>
          </span>
        ))}
        {summary.after}
      </span>
      <button ref={closeButton} className="btn btn-ghost" type="button" onClick={close}>
        Close
      </button>
    </p>
  )
  if (running) {
    return (
      <div className="make-all">
        <p className="make-all-running">
          <span>{runningLine(making)}</span>
          <button
            ref={stopButton}
            className="btn"
            type="button"
            aria-disabled={stopAll.isPending || undefined}
            onClick={() => !stopAll.isPending && stopAll.mutate()}
            {...stopFocus}
          >
            Stop all
          </button>
        </p>
        {stopAll.isError && (
          <span className="adopt-error" role="alert">
            {EFFECTS_STOP_FAILED}
          </span>
        )}
      </div>
    )
  }
  const ready = (() => {
    if (!plan.startable.length) {
      return plan.chosen.length > 0 ? (
        <p className="make-all-line muted">Every effect has a chosen take.</p>
      ) : null
    }
    if (!models || !('canMake' in models)) return null
    if (!models.canMake) {
      return (
        <p className="make-all-line">
          <span>Sound effects can&apos;t be made yet. Setup says what is missing.</span>
          <a className="btn" href={routeHref({ view: 'setup' })}>
            Open Setup
          </a>
        </p>
      )
    }
    return (
      <p className="make-all-line">
        <span>{makeAllLine(plan.startable.length)}</span>
        <button
          ref={(element) => {
            makeButton.current = element
            opener.current = element
          }}
          className="btn btn-primary"
          type="button"
          onClick={() => {
            setFailed(false)
            setAsking(true)
          }}
        >
          {makeAllButton()}
        </button>
      </p>
    )
  })()
  return (
    <>
      <div className="make-all">
        {summaryLine}
        {ready}
        {failed && !asking && (
          <span className="adopt-error" role="alert">
            {EFFECTS_MAKE_ALL_FAILED}
          </span>
        )}
      </div>
      {asking && models && 'canMake' in models && plan.startable.length > 0 && (
        <Question
          plan={plan}
          models={models}
          pending={make.isPending}
          onCancel={() => {
            refocus()
            setAsking(false)
          }}
          onMake={() =>
            make.mutate(
              plan.startable.map((row) => row.id),
              {
                onSuccess: (result) => {
                  setAsking(false)
                  if (result.ok && result.started.length > 0) focusStop.current = true
                  else setFailed(true)
                },
                onError: () => {
                  setAsking(false)
                  setFailed(true)
                },
              },
            )
          }
        />
      )}
    </>
  )
}

/** The question inside the panel: what is made, on which model, for how long, and for whom. */
function Question({
  plan,
  models,
  pending,
  onCancel,
  onMake,
}: {
  plan: ReturnType<typeof planMakeAll>
  models: {
    projectModel: EffectModelId
    uv: boolean
    models: { id: EffectModelId; download: EffectModelState['download']; failed: boolean }[]
  }
  pending: boolean
  onCancel: () => void
  onMake: () => void
}) {
  const make = useRef<HTMLButtonElement | null>(null)
  useEffect(() => make.current?.focus(), [])
  const states = Object.fromEntries(
    models.models.map(({ id, download, failed }) => [id, { download, failed }]),
  ) as Record<EffectModelId, EffectModelState>
  const model = defaultEffectModel(models.projectModel, states, models.uv)
  const main = states[models.projectModel]
  const reason =
    model === models.projectModel
      ? null
      : main.download === 'absent'
        ? 'absent'
        : main.download === 'partial'
          ? 'partial'
          : 'failed'
  const takes = plan.startable.length * MAKE_ALL_TAKES
  const heading = makeAllHeading(takes, plan.startable.length)
  return (
    <div
      className="make-all-question"
      role="alertdialog"
      aria-label={heading}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) onCancel()
      }}
    >
      <h2 className="section-title">{heading}</h2>
      <p className="muted">{makeAllModelLine(models.projectModel, model, reason, takes)}</p>
      <ul className="confirm-effects">
        {plan.startable.map((row) => (
          <li key={row.id}>{row.name}</li>
        ))}
      </ul>
      {leftOutLines(
        plan.chosen.map((row) => row.name),
        plan.busy.map((row) => row.name),
      ).map((line) => (
        <p className="muted small" key={line}>
          {line}
        </p>
      ))}
      <div className="confirm-actions">
        <button className="btn btn-ghost" type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button
          ref={make}
          className="btn btn-primary"
          type="button"
          disabled={pending}
          onClick={onMake}
        >
          Make {takes} takes
        </button>
      </div>
    </div>
  )
}
