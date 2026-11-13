import { off } from '../../off'
import { EFFECTS_PENDING } from '../../effectsText'
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
import { useMakeAllPanel } from '../../components/useMakeAllPanel'
import { routeHref } from '../../route'

/**
 * The panel's action on the Sound effects list: how many effects have no chosen take and a button
 * that asks before it makes four takes for each; while takes are made, what is running with Stop
 * all; then how it went, until Close. Nothing starts without the question's Make.
 */
export function EffectsMakeAll({ effects }: { effects: EffectsSummary }) {
  const making = useEffectsMaking().data ?? {}
  const models = useEffectModels().data
  const running = Object.keys(making).length > 0
  const { batch, close: closeBatch } = useEffectsBatch(running)
  const make = useMakeAllEffects()
  const stopAll = useStopAllEffects()
  const [failed, setFailed] = useState(false)
  const finished = Boolean(batch && !batch.running && !running)
  const ui = useMakeAllPanel({
    busy: running || Boolean(batch?.running),
    summary: Boolean(batch),
    settled: finished,
    resetStop: stopAll.reset,
    fallback: () => document.querySelector<HTMLElement>('.status-panel'),
  })
  const { open: asking, setOpen: setAsking, stopFocus } = ui
  const plan = planMakeAll(effects.rows, making)
  if (plan.lockUnread) return null
  const names = Object.fromEntries(effects.rows.map((row) => [row.id, row.name]))
  const summary = batch && !batch.running && !running ? batchSummary(batch) : null
  const close = () => {
    closeBatch()
    ui.closed()
  }
  const summaryLine = summary && (
    <p className="effects-make-all-summary" role="status">
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
      <button ref={ui.closeButton} className="btn btn-ghost" type="button" onClick={close}>
        Close
      </button>
    </p>
  )
  if (running) {
    return (
      <div className="effects-make-all">
        <p className="effects-make-all-running">
          <span>{runningLine(making)}</span>
          <button
            ref={ui.stopButton}
            className="btn"
            type="button"
            {...off(stopAll.isPending && EFFECTS_PENDING)}
            onClick={() => stopAll.mutate()}
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
        <p className="effects-make-all-line muted">Every effect has a chosen take.</p>
      ) : null
    }
    if (!models || !('canMake' in models)) return null
    if (!models.canMake) {
      return (
        <p className="effects-make-all-line">
          <span>Sound effects can&apos;t be made yet. Setup says what is missing.</span>
          <a className="btn" href={routeHref({ view: 'setup' })}>
            Open Setup
          </a>
        </p>
      )
    }
    return (
      <p className="effects-make-all-line">
        <span>{makeAllLine(plan.startable.length)}</span>
        <button
          ref={ui.button}
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
      <div className="effects-make-all">
        {summaryLine}
        {summaryLine ? null : ready}
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
            setAsking(false)
            ui.goTo('button')
          }}
          onMake={() =>
            make.mutate(
              plan.startable.map((row) => row.id),
              {
                onSuccess: (result) => {
                  setAsking(false)
                  if (result.ok && result.started.length > 0) ui.goTo('stop')
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
      className="effects-make-all-question"
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
        <button
          className="btn btn-ghost"
          type="button"
          {...off(pending && EFFECTS_PENDING)}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          ref={make}
          className="btn btn-primary"
          type="button"
          {...off(pending && EFFECTS_PENDING)}
          onClick={onMake}
        >
          Make {takes} takes
        </button>
      </div>
    </div>
  )
}
