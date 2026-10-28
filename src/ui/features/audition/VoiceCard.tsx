import type { ReactNode } from 'react'
import type { Candidate, Voice } from '../../../core/voiceSearch'
import { providerOf } from '../../../core/voices'
import { takeUrl } from '../../api'
import { sampleClip, takeClip } from '../../board'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { compact } from '../../format'
import { providerWords } from '../../voiceId'

/** What a card says while its take waits. */
const WAITS = {
  money: 'Take waits for more money',
  credits: 'Take waits for credits',
  'more-credits': 'Take waits for more credits',
}

/**
 * A voice in an audition: who made it and how popular it is, its take (the audition phrase in the
 * character's style) or a button to record one (or why it waits), its provider's own sample, and, on the board, what can be done with it (`actions`).
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
  waits,
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
  /**
   * What its take waits for: more money (a paid audition whose money is used), credits (an
   * ElevenLabs voice in an audition given none) or more of them (its credits used).
   */
  waits?: 'money' | 'credits' | 'more-credits'
  /** Whether the voice is on the shortlist, which is shown apart. */
  listed?: boolean
  /** On the board: buttons for what can be done with the voice. */
  actions?: ReactNode
}) {
  const sample = voice.sample
  // Fish's design, not yet on the account: its preview is its take, and it has no sample or id.
  const designed = voice.design !== undefined
  const eleven = providerOf(voice.id) === 'elevenlabs'
  const words = providerWords(voice.id)
  return (
    <article
      className={`card voice-card${listed ? ' kept' : ''}${voice.own ? ' yours' : ''}${designed ? ' designed' : ''}`}
      aria-label={voice.title}
    >
      <div className="card-head">
        <div className="card-title">
          <strong>{voice.title || 'Untitled voice'}</strong>
          <span className="muted voice-meta">
            {designed ? (
              'Designed · not saved'
            ) : voice.own ? (
              'Your voice · private'
            ) : eleven ? (
              'ElevenLabs voice'
            ) : (
              <>
                {voice.author ? `by ${voice.author} · ` : ''}
                {compact(voice.uses)} uses · {compact(voice.likes)} likes
              </>
            )}
          </span>
        </div>
        {note || voice.own || designed ? (
          <span className="badges">
            {note && <span className="badge ok">{note}</span>}
            {voice.own && <span className="badge yours">Yours</span>}
            {designed && <span className="badge designed">Designed</span>}
          </span>
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
                playing === takeClip(voice.id) ? 'Stop' : `Play the take of ${voice.title}`
              }
              onClick={() => toggle(takeClip(voice.id), takeUrl(take))}
            >
              {playing === takeClip(voice.id) ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span className="take-label">
              {designed
                ? 'Take: the audition phrase, as designed'
                : 'Take: the audition phrase in character'}
            </span>
          </>
        ) : designed ? (
          <span className="muted">The preview of this design is no longer kept.</span>
        ) : waits ? (
          <span className="muted take-waits">{WAITS[waits]}</span>
        ) : (
          <button className="btn" type="button" disabled={recording} onClick={onRecord}>
            {recording ? 'Recording take…' : 'Record take'}
          </button>
        )}
      </div>
      {error && <span className="adopt-error take-error">{error}</span>}
      {!designed && (
        <div className="voice-sample">
          {sample ? (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label={
                  playing === sampleClip(voice.id) ? 'Stop' : `${words.play} of ${voice.title}`
                }
                onClick={() => toggle(sampleClip(voice.id), sample.audio)}
              >
                {playing === sampleClip(voice.id) ? <PauseIcon /> : <PlayIcon />}
              </button>
              <span className="muted sample-text" title={sample.text}>
                {words.sample}
                {sample.text ? `: “${sample.text}”` : ''}
              </span>
            </>
          ) : (
            <span className="muted">{words.noSample}</span>
          )}
        </div>
      )}
      {actions && <div className="card-actions">{actions}</div>}
      {!designed && <span className="mono muted voice-id">{voice.id}</span>}
    </article>
  )
}
