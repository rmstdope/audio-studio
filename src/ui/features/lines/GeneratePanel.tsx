import { useEffect, useState } from 'react'
import type { StaleReason } from '../../../core/fingerprint'
import { displayName } from '../../../core/summary'
import type { JobKind } from '../../../services/jobs'
import { useJob, useJobActions, usePlan } from '../../api'
import { Problems } from '../../components/Problems'
import { centsUp, dollars, plural } from '../../format'
import { castNote, generateLabel, translatedNote } from '../../languages'
import { REASON } from '../../status'

/** How a job of each kind is told: while it runs, a line in it, and a line done. */
const WORDS: Record<JobKind, { running: string; doing: string; done: string }> = {
  record: { running: 'Generating', doing: 'Recording', done: 'recorded' },
  measure: { running: 'Measuring', doing: 'Measuring', done: 'measured' },
  check: { running: 'Checking again', doing: 'Checking', done: 'checked again' },
}

/**
 * Generating a part, or one character in it: the plan (what would be recorded and why, weak lines
 * to retake if asked, the orphans, the model and its cost), then the job's progress with Cancel,
 * then what it did. Clips never checked by Whisper can be measured instead, and weak lines checked
 * again, both without new audio.
 */
export function GeneratePanel({
  partId,
  language,
  speaker,
  models,
}: {
  partId: string
  /** The language to record, in a project with several; null in a project with one. */
  language: { id: string; name: string } | null
  speaker: string | null
  /** The draft and final models: a final step is offered only when they differ. */
  models: { draft: string; final: string }
}) {
  const [retakeWeak, setRetakeWeak] = useState(false)
  const [stage, setStage] = useState<'draft' | 'final'>('draft')
  const hasFinal = models.final !== models.draft
  const plan = usePlan(partId, speaker, retakeWeak, hasFinal ? stage : 'draft', language?.id)
  const job = useJob(partId, language?.id)
  const { start, cancel } = useJobActions(partId, language?.id)
  // A paid plan's Generate asks once more; a different plan clears the question.
  const [confirming, setConfirming] = useState(false)
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
  const ceilingShown = plan.data?.ok ? plan.data.plan.ceiling : null
  useEffect(() => setConfirming(false), [ceilingShown, speaker, retakeWeak, stage])
  useEffect(() => setRemoveOrphans(false), [orphanSet])

  if (current && (running || shownJob === current.id)) {
    const progress = current.total ? (current.done / current.total) * 100 : 100
    // Measuring and checking again hear clips with Whisper, without new audio.
    const measuring = current.kind === 'measure' || current.kind === 'check'
    return (
      <section className="panel generate" aria-label="Generation">
        <div className="generate-head">
          <div>
            <span className="label">
              {running
                ? current.status === 'cancelling'
                  ? 'Cancelling'
                  : WORDS[current.kind].running
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
            {WORDS[current.kind].doing} {current.recording.join(', ')}
          </span>
        )}
        {!running && (
          <span className="muted">
            {plural(
              current.done - current.failed.length - current.skipped,
              measuring ? 'clip' : 'line',
            )}{' '}
            {WORDS[current.kind].done}
            {current.skipped
              ? ` · ${current.skipped} ${measuring ? 'no longer needed meanwhile' : 'already up to date'}`
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
  const paid = p.keys.length > 0 && (p.ceiling ?? 0) > 0
  // What "Pay up to" shows and sends: the most it can cost, rounded up to the cent.
  const agreed = centsUp(p.ceiling ?? 0)
  const nothing = p.keys.length === 0 && (p.orphans.length === 0 || !removeOrphans)
  // The previous plan, shown while the new one loads: nothing is started from it.
  const waiting = plan.isPlaceholderData
  const reasons = (Object.entries(p.stale) as [StaleReason, number][]).sort((a, b) => b[1] - a[1])

  return (
    <section className="panel generate" aria-label="Generation plan">
      <div className="generate-head">
        <div>
          <span className="label">
            {generateLabel(
              stage === 'final' && hasFinal ? 'Final recording' : 'Generate',
              language?.name ?? null,
              speaker ? displayName(speaker) : null,
            )}
          </span>
          <strong>
            {p.keys.length
              ? `Record ${plural(p.keys.length, 'line')}`
              : p.final
                ? 'Every line is final'
                : 'Every line is recorded'}
          </strong>
        </div>
        <div className="header-actions">
          {confirming && (
            <button className="btn" type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          )}
          <button
            className="btn btn-primary"
            type="button"
            disabled={nothing || waiting || start.isPending}
            title={
              paid
                ? 'The most this can cost on your Fish account: every line, every take'
                : undefined
            }
            onClick={() => {
              // A paid plan asks once more, naming the most it can cost; that is what is agreed.
              if (paid && !confirming) return setConfirming(true)
              setConfirming(false)
              start.mutate(
                {
                  kind: 'record',
                  stage: hasFinal ? stage : 'draft',
                  retakeWeak,
                  speaker,
                  keys: p.keys,
                  orphans: removeOrphans ? p.orphans : [],
                  confirmedCost: paid ? agreed : undefined,
                },
                {
                  onSuccess: (started) => {
                    setShownJob(started.id)
                    setRemoveOrphans(false)
                  },
                },
              )
            }}
          >
            {start.isPending
              ? 'Starting…'
              : confirming
                ? `Pay up to ${dollars(agreed)}`
                : 'Generate'}
          </button>
        </div>
      </div>
      {hasFinal && (
        <div className="stage-switch" role="radiogroup" aria-label="Which recording">
          {(['draft', 'final'] as const).map((which) => (
            <label key={which} className={stage === which ? 'on' : ''}>
              <input
                type="radio"
                name={`stage-${partId}`}
                checked={stage === which}
                onChange={() => setStage(which)}
              />
              {which === 'draft' ? 'Draft' : 'Final'} <span className="mono">{models[which]}</span>
            </label>
          ))}
        </div>
      )}
      {stage === 'final' && hasFinal && (
        <span className="muted">
          The final recording records every line whose clip was not made with {models.final} yet;
          draft plans leave final clips alone.
        </span>
      )}
      {(p.missing > 0 || reasons.length > 0 || p.drafted > 0 || p.untracked > 0) && (
        <ul className="plan-list">
          {p.missing > 0 && <li>{plural(p.missing, 'missing line')}</li>}
          {p.drafted > 0 && <li>{plural(p.drafted, 'drafted line')}, recorded again</li>}
          {p.untracked > 0 && (
            <li>{plural(p.untracked, 'clip')} made before the studio, recorded again</li>
          )}
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
      {p.checked && p.recheck.length > 0 && (
        <div className="measure">
          <span className="muted">
            {plural(p.recheck.length, 'weak line')}, final ones included. Checking again has Whisper
            hear their clips with today's rules, without new audio; lines heard well enough are weak
            no longer.
          </span>
          <button
            className="btn"
            type="button"
            disabled={waiting || start.isPending}
            onClick={() =>
              start.mutate(
                { kind: 'check', speaker, keys: p.recheck, orphans: [] },
                { onSuccess: (started) => setShownJob(started.id) },
              )
            }
          >
            Check {plural(p.recheck.length, 'weak line')} again
          </button>
        </div>
      )}
      {p.uncast.length > 0 && (
        <span className="cast-note">
          {castNote(language?.name ?? null, p.uncast.map(displayName))}
        </span>
      )}
      {p.untranslated > 0 && <span className="muted">{translatedNote(p.untranslated)}</span>}
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
          ? `each take checked with Whisper${language ? ` in ${language.name}` : ''}, up to ${plural(p.takes, 'take')} a line${
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
