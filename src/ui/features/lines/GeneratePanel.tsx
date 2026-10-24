import { useEffect, useState } from 'react'
import type { StaleReason } from '../../../core/fingerprint'
import { displayName } from '../../../core/summary'
import { useJob, useJobActions, usePlan } from '../../api'
import { Problems } from '../../components/Problems'
import { dollars, plural } from '../../format'
import { REASON } from '../../status'

/**
 * Generating a part, or one character in it: the plan (what would be recorded and why, weak lines
 * to retake if asked, the orphans, the model and its cost), then the job's progress with Cancel,
 * then what it did. Clips never checked by Whisper can be measured instead, without new audio.
 */
export function GeneratePanel({ partId, speaker }: { partId: string; speaker: string | null }) {
  const [retakeWeak, setRetakeWeak] = useState(false)
  const plan = usePlan(partId, speaker, retakeWeak)
  const job = useJob(partId)
  const { start, cancel } = useJobActions(partId)
  const [removeOrphans, setRemoveOrphans] = useState(false)
  // A finished job is shown only if it was started here, until it is closed.
  const [shownJob, setShownJob] = useState<string | null>(null)

  const current = job.data ?? null
  const running = current && (current.status === 'running' || current.status === 'cancelling')

  // A job seen running stays on screen until closed, so its result and failures are always seen,
  // even after leaving the page and coming back while it ran.
  const runningId = running ? current.id : null
  useEffect(() => {
    if (runningId) setShownJob(runningId)
  }, [runningId])

  // The orphan box only ever confirms the orphans shown: a different set clears it.
  const orphanSet = plan.data?.ok ? plan.data.plan.orphans.join('\n') : ''
  useEffect(() => setRemoveOrphans(false), [orphanSet])

  if (current && (running || shownJob === current.id)) {
    const progress = current.total ? (current.done / current.total) * 100 : 100
    const measuring = current.kind === 'measure'
    return (
      <section className="panel generate" aria-label="Generation">
        <div className="generate-head">
          <div>
            <span className="label">
              {running
                ? current.status === 'cancelling'
                  ? 'Cancelling'
                  : measuring
                    ? 'Measuring'
                    : 'Generating'
                : current.status === 'cancelled'
                  ? 'Cancelled'
                  : 'Done'}
            </span>
            <strong>
              {current.done} of {plural(current.total, measuring ? 'clip' : 'line')}
              {current.speaker ? ` · ${displayName(current.speaker)}` : ''}
            </strong>
          </div>
          {running ? (
            <button
              className="btn"
              type="button"
              disabled={
                current.status === 'cancelling' || current.removingOrphans || cancel.isPending
              }
              onClick={() => cancel.mutate(current.id)}
            >
              {current.status === 'cancelling' ? 'Finishing lines under way…' : 'Cancel'}
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => setShownJob(null)}>
              Close
            </button>
          )}
        </div>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        {running && current.recording.length > 0 && (
          <span className="muted">
            {measuring ? 'Measuring' : 'Recording'} {current.recording.join(', ')}
          </span>
        )}
        {!running && (
          <span className="muted">
            {measuring
              ? `${plural(current.done - current.failed.length - current.skipped, 'clip')} measured`
              : `${plural(current.done - current.failed.length - current.skipped, 'line')} recorded`}
            {current.skipped
              ? ` · ${current.skipped} ${measuring ? 'recorded again meanwhile' : 'already up to date'}`
              : ''}
            {current.removed ? ` · ${plural(current.removed, 'orphaned clip')} removed` : ''}
            {current.status === 'cancelled' ? ' · the rest were left as they were' : ''}
          </span>
        )}
        {current.orphanError && (
          <span className="adopt-error">
            The orphaned clips could not be removed: {current.orphanError}
          </span>
        )}
        {current.failed.length > 0 && (
          <ul className="failures">
            {current.failed.map((f) => (
              <li key={f.key}>
                <span className="mono">{f.key}</span>: {f.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  if (plan.isPending) return <section className="panel muted">Planning…</section>
  if (plan.isError)
    return <section className="panel muted">Could not plan: {plan.error.message}</section>
  const answer = plan.data
  if (!answer.ok) {
    return <Problems title="Generation cannot be planned" problems={answer.problems} />
  }
  const { plan: p } = answer
  const nothing = p.keys.length === 0 && (p.orphans.length === 0 || !removeOrphans)
  // The previous plan, shown while the new one loads: nothing is started from it.
  const waiting = plan.isPlaceholderData
  const reasons = (Object.entries(p.stale) as [StaleReason, number][]).sort((a, b) => b[1] - a[1])

  return (
    <section className="panel generate" aria-label="Generation plan">
      <div className="generate-head">
        <div>
          <span className="label">
            Generate · {speaker ? displayName(speaker) : 'every character'}
          </span>
          <strong>
            {p.keys.length ? `Record ${plural(p.keys.length, 'line')}` : 'Every line is recorded'}
          </strong>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={nothing || waiting || start.isPending}
          onClick={() =>
            start.mutate(
              {
                kind: 'record',
                retakeWeak,
                speaker,
                keys: p.keys,
                orphans: removeOrphans ? p.orphans : [],
              },
              {
                onSuccess: (started) => {
                  setShownJob(started.id)
                  setRemoveOrphans(false)
                },
              },
            )
          }
        >
          {start.isPending ? 'Starting…' : 'Generate'}
        </button>
      </div>
      {(p.missing > 0 || reasons.length > 0) && (
        <ul className="plan-list">
          {p.missing > 0 && <li>{plural(p.missing, 'missing line')}</li>}
          {reasons.map(([reason, n]) => (
            <li key={reason}>
              {plural(n, 'line')}: {REASON[reason]}
            </li>
          ))}
        </ul>
      )}
      {p.weak.length > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={retakeWeak}
            onChange={(e) => setRetakeWeak(e.target.checked)}
          />
          Also retake {plural(p.weak.length, 'weak line')} (Whisper heard too few of their words)
        </label>
      )}
      {p.checked && p.unmeasured.length > 0 && (
        <div className="measure">
          <span className="muted">
            {plural(p.unmeasured.length, 'clip')} never checked by Whisper. Measuring finds their
            word timings and weak lines, without new audio.
          </span>
          <button
            className="btn"
            type="button"
            disabled={waiting || start.isPending}
            onClick={() =>
              start.mutate(
                { kind: 'measure', speaker, keys: p.unmeasured, orphans: [] },
                { onSuccess: (started) => setShownJob(started.id) },
              )
            }
          >
            Measure {plural(p.unmeasured.length, 'clip')}
          </button>
        </div>
      )}
      {p.uncast.length > 0 && (
        <span className="cast-note">
          Not recorded until cast: {p.uncast.map(displayName).join(', ')}.
        </span>
      )}
      {p.orphans.length > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={removeOrphans}
            onChange={(e) => setRemoveOrphans(e.target.checked)}
          />
          Also remove {plural(p.orphans.length, 'orphaned clip')} (their lines left the dialog)
        </label>
      )}
      <span className="muted plan-facts">
        {p.model} · {formatBytes(p.bytes)} of text ·{' '}
        {p.cost === null ? 'price unknown' : p.cost ? `about ${dollars(p.cost)}` : 'free'} ·{' '}
        {p.checked
          ? `each take checked with Whisper, up to ${plural(p.takes, 'take')} a line${
              p.cost ? ` (at most about ${dollars(p.cost * p.takes)})` : ''
            } · `
          : 'takes not checked · '}
        files are written in place; commit them when you are happy
      </span>
      {start.isError && <span className="adopt-error">{start.error.message}</span>}
    </section>
  )
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}
