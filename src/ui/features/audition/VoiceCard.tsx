import type { ReactNode } from 'react'
import type { Candidate, Voice } from '../../../core/voiceSearch'
import { takeUrl } from '../../api'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { compact } from '../../format'

/**
 * A voice in an audition: who made it and how popular it is, its take (the audition phrase in the
 * character's style) or a button to record one, Fish's own sample, and, on the board, what can be
 * done with it (`actions`).
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
  listed = false,
  actions,
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
  /** Whether the voice is on the shortlist, which is shown apart. */
  listed?: boolean
  /** On the board: buttons for what can be done with the voice. */
  actions?: ReactNode
}) {
  const sample = voice.sample
  return (
    <article className={`card voice-card${listed ? ' kept' : ''}`} aria-label={voice.title}>
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
            {recording ? 'Recording take…' : 'Record take'}
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
      {actions && <div className="verdict">{actions}</div>}
      <span className="mono muted voice-id">{voice.id}</span>
    </article>
  )
}
