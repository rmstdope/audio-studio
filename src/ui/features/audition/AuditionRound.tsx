import { useState, type FormEvent } from 'react'
import { canMoveOn, finalist, remaining, type AuditionSession } from '../../../core/audition'
import type { SessionView } from '../../../services/sessions'
import { useCast, useSessionAction, useTakes, type SessionAction } from '../../api'
import { Problems } from '../../components/Problems'
import { plural } from '../../format'
import { VoiceCard } from './VoiceCard'

/**
 * An audition round: the voices in it with their takes, Keep and Drop on each, and the ways on:
 * bring in more voices, add one by id, the next round with the voices kept, or, once one voice is
 * left, cast it.
 */
export function AuditionRound({
  characterId,
  view,
  playing,
  toggle,
  cast,
}: {
  characterId: string
  view: Extract<SessionView, { ok: true }> & { session: AuditionSession }
  playing: string | null
  toggle: (id: string, url: string) => void
  /** Casting, owned by the page so its result outlives the round. */
  cast: ReturnType<typeof useCast>
}) {
  const { session, takes } = view
  const act = useSessionAction(characterId)
  const recorder = useTakes(characterId)
  const [voiceId, setVoiceId] = useState('')

  const run = (action: SessionAction) => act.mutate(action)
  const kept = session.pool.filter((v) => session.verdicts[v] === 'keep').length
  const dropped = session.pool.length - remaining(session).length
  const undecided = session.pool.length - kept - dropped
  const winner = finalist(session)
  const toRecord = remaining(session).filter((v) => !takes[v] && !recorder.recording.has(v))
  const failed = act.data && !act.data.ok ? act.data : null
  const castFailed = cast.data && !cast.data.ok ? cast.data : null

  const hint = winner
    ? `One voice left: cast ${session.voices[winner]?.title ?? winner}, or bring in more to compare.`
    : undecided === session.pool.length
      ? 'Listen to the takes, then keep or drop each voice.'
      : canMoveOn(session)
        ? `${plural(dropped, 'voice')} dropped. The next round goes on with the rest; undecided voices stay.`
        : 'Drop at least one voice to go on to the next round.'

  const addById = (event: FormEvent) => {
    event.preventDefault()
    const id = voiceId.trim().replace(/^.*\//, '')
    if (!id) return
    run({ action: 'add', body: { voice: id } })
    setVoiceId('')
  }

  return (
    <div className="section">
      <ol className="rounds" aria-label="Rounds">
        {session.rounds.map((r) => (
          <li key={r.round} className="round-chip">
            Round {r.round} <span className="muted">{plural(r.voices, 'voice')}</span>
          </li>
        ))}
        <li className="round-chip now" aria-current="step">
          Round {session.round}{' '}
          <span>
            {plural(session.pool.length, 'voice')} · {kept} kept · {dropped} dropped
          </span>
        </li>
      </ol>

      <div className="cards">
        {session.pool.map((id) => {
          const voice = session.voices[id]
          if (!voice) return null
          return (
            <VoiceCard
              key={id}
              voice={voice}
              candidate={session.matched[id] ? { voice, matched: session.matched[id] } : undefined}
              keywordCount={session.keywords.length}
              note={id === session.current ? 'Cast now' : undefined}
              playing={playing}
              toggle={toggle}
              take={takes[id] ?? null}
              recording={recorder.recording.has(id)}
              error={recorder.errors[id] ?? null}
              onRecord={() => void recorder.record(id)}
              verdict={session.verdicts[id] ?? null}
              onVerdict={(verdict) => run({ action: 'verdict', body: { voice: id, verdict } })}
            />
          )
        })}
      </div>

      <div className="round-bar panel">
        <div className="round-hint">
          <strong>{hint}</strong>
          <span className="muted">
            Dropped voices never come back in this audition
            {session.dropped.length ? ` (${session.dropped.length} so far)` : ''}.
          </span>
        </div>
        <div className="round-actions">
          {toRecord.length > 0 && (
            <button
              className="btn"
              type="button"
              onClick={() => toRecord.forEach((v) => void recorder.record(v))}
            >
              Record {plural(toRecord.length, 'missing take')}
            </button>
          )}
          <button
            className="btn"
            type="button"
            disabled={act.isPending}
            onClick={() => run({ action: 'more' })}
          >
            Bring in more
          </button>
          <form className="add-voice" onSubmit={addById}>
            <input
              className="search"
              placeholder="Fish voice id or URL"
              aria-label="Fish voice id or URL"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
            />
            <button className="btn" type="submit" disabled={!voiceId.trim()}>
              Add
            </button>
          </form>
          {winner ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={cast.isPending}
              onClick={() => cast.mutate()}
            >
              {cast.isPending ? 'Casting…' : `Cast ${session.voices[winner]?.title ?? winner}`}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              disabled={!canMoveOn(session) || act.isPending}
              onClick={() => run({ action: 'next' })}
            >
              Next round
            </button>
          )}
          <button
            className="btn btn-ghost"
            type="button"
            disabled={act.isPending}
            onClick={() => run({ action: 'discard' })}
          >
            End audition
          </button>
        </div>
        {failed && 'problems' in failed && (
          <Problems title="The audition could not go on" problems={failed.problems} />
        )}
        {failed && 'message' in failed && <span className="adopt-error">{failed.message}</span>}
        {castFailed && 'problems' in castFailed && (
          <Problems title="The voice could not be cast" problems={castFailed.problems} />
        )}
        {castFailed && 'message' in castFailed && (
          <span className="adopt-error">{castFailed.message}</span>
        )}
        {(act.isError || cast.isError) && (
          <span className="adopt-error">{(act.error ?? cast.error)?.message}</span>
        )}
      </div>
    </div>
  )
}
