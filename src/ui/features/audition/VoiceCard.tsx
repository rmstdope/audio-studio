import type { Verdict } from '../../../core/audition'
import type { Candidate, Voice } from '../../../core/voiceSearch'
import { takeUrl } from '../../api'
import { CheckIcon, CrossIcon, PauseIcon, PlayIcon } from '../../components/icons'
import { compact } from '../../format'

/**
 * A voice in an audition: who made it and how popular it is, its take (the audition phrase in the
 * character's style) or a button to record one, Fish's own sample, and, in a round, Keep and Drop.
 */
export function VoiceCard({
  voice,
  candidate,
  keywordCount,
  playing,
  toggle,
  note,
  take,
  recording,
  error,
  onRecord,
  verdict,
  onVerdict,
}: {
  voice: Voice
  candidate?: Candidate
  keywordCount?: number
  playing: string | null
  toggle: (id: string, url: string) => void
  note?: string
  /** The key of this voice's recorded take, if any. */
  take: string | null
  recording: boolean
  error: string | null
  onRecord: () => void
  /** In an audition round: the verdict on the voice, and how to change it. */
  verdict?: Verdict | null
  onVerdict?: (verdict: Verdict | null) => void
}) {
  const sample = voice.sample
  const state = verdict === 'keep' ? ' kept' : verdict === 'drop' ? ' dropped' : ''
  return (
    <article className={`card voice-card${state}`} aria-label={voice.title}>
      <div className="card-head">
        <div className="card-title">
          <strong>{voice.title || 'Untitled voice'}</strong>
          <span className="muted voice-meta">
            {voice.author ? `by ${voice.author} · ` : ''}
            {compact(voice.uses)} uses · {compact(voice.likes)} likes
          </span>
        </div>
        {note ? (
          <span className="badge ok">{note}</span>
        ) : candidate && keywordCount ? (
          <span className="chip" title={candidate.matched.join(', ')}>
            {candidate.matched.length}/{keywordCount} keywords
          </span>
        ) : null}
      </div>
      {voice.description && <p className="voice-description">{voice.description}</p>}
      {voice.tags.length > 0 && (
        <div className="chips">
          {voice.tags.slice(0, 6).map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="voice-take">
        {take ? (
          <>
            <button
              type="button"
              className="icon-btn take-play"
              aria-label={
                playing === `take:${voice.id}` ? 'Stop' : `Play the take of ${voice.title}`
              }
              onClick={() => toggle(`take:${voice.id}`, takeUrl(take))}
            >
              {playing === `take:${voice.id}` ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span className="take-label">Take: the audition phrase in character</span>
          </>
        ) : (
          <button className="btn" type="button" disabled={recording} onClick={onRecord}>
            {recording ? 'Recording…' : 'Record take'}
          </button>
        )}
      </div>
      {error && <span className="adopt-error take-error">{error}</span>}
      <div className="voice-sample">
        {sample ? (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label={
                playing === `sample:${voice.id}` ? 'Stop' : `Play Fish’s sample of ${voice.title}`
              }
              onClick={() => toggle(`sample:${voice.id}`, sample.audio)}
            >
              {playing === `sample:${voice.id}` ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span className="muted sample-text" title={sample.text}>
              Fish sample{sample.text ? `: “${sample.text}”` : ''}
            </span>
          </>
        ) : (
          <span className="muted">No sample from Fish</span>
        )}
      </div>
      {onVerdict && (
        <div className="verdict">
          <button
            type="button"
            className="btn verdict-keep"
            aria-pressed={verdict === 'keep'}
            onClick={() => onVerdict(verdict === 'keep' ? null : 'keep')}
          >
            <CheckIcon /> Keep
          </button>
          <button
            type="button"
            className="btn verdict-drop"
            aria-pressed={verdict === 'drop'}
            onClick={() => onVerdict(verdict === 'drop' ? null : 'drop')}
          >
            <CrossIcon /> Drop
          </button>
        </div>
      )}
      <span className="mono muted voice-id">{voice.id}</span>
    </article>
  )
}
