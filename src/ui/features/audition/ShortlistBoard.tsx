import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AuditionSession } from '../../../core/audition'
import type { SessionView } from '../../../services/sessions'
import { useCast, useRuledOut, useSessionAction, useTakes, type SessionAction } from '../../api'
import {
  castEffects,
  droppedRuledOut,
  isRuledOut,
  stopEffectsFor,
  takesToRecord,
  undoFor,
} from '../../board'
import { CheckIcon, CrossIcon } from '../../components/icons'
import { Confirm } from '../../components/Confirm'
import { Failure } from '../../components/Failure'
import { routeHref } from '../../route'
import { voiceIdFrom } from '../../voiceId'
import { VoiceCard } from './VoiceCard'

/** What the board is asking about before it acts: casting a voice, or stopping the audition. */
type Asking = { kind: 'cast'; voice: string } | { kind: 'stop' } | null

/**
 * An audition as one board: the shortlist the cast is chosen from, the voices to hear with Drop
 * and Shortlist on each, and ways to bring in more. Takes record by themselves (the audition
 * model is free). A drop can be undone; casting, keeping and stopping say what they do first.
 */
export function ShortlistBoard({
  characterId,
  name,
  lines,
  view,
  playing,
  toggle,
  cast,
  titles,
}: {
  characterId: string
  /** The character's name. */
  name: string
  /** The character's lines in every part. */
  lines: number
  view: Extract<SessionView, { ok: true }> & { session: AuditionSession }
  playing: string | null
  toggle: (id: string, url: string) => void
  /** Casting, owned by the page so its result outlives the board. */
  cast: ReturnType<typeof useCast>
  /** Short part titles by id, for saying where lines go stale. */
  titles: Map<string, string>
}) {
  const { session, takes, audition } = view
  const act = useSessionAction(characterId)
  const recorder = useTakes(characterId)
  const ruledOut = useRuledOut(characterId)
  const [asking, setAsking] = useState<Asking>(null)
  // The voice this page dropped last; its drop can be undone while it is the last one.
  const [droppedHere, setDroppedHere] = useState<string | null>(null)
  const [voiceId, setVoiceId] = useState('')
  const [idError, setIdError] = useState<string | null>(null)

  // Every take is asked for once per phrase, so a take the cache cannot show is not asked again.
  const asked = useRef(new Set<string>())
  const onBoard = [...session.shortlist, ...session.toHear]
  const missing = audition
    ? takesToRecord(onBoard, takes, recorder.recording, recorder.errors).filter(
        (v) => !asked.current.has(`${audition.spoken}\n${v}`),
      )
    : []
  useEffect(() => {
    for (const voice of missing) {
      asked.current.add(`${audition?.spoken}\n${voice}`)
      void recorder.record(voice)
    }
    // `missing` is new on every render; what it holds is what matters.
  }, [missing.join(',')])

  const run = (action: SessionAction, onDone?: () => void) => {
    setAsking(null)
    act.mutate(action, { onSuccess: (result) => result.ok && onDone?.() })
  }
  const move = (voice: string, to: 'shortlist' | 'unlist' | 'drop') =>
    run({ action: 'move', body: { voice, move: to } }, () =>
      setDroppedHere(to === 'drop' ? voice : null),
    )
  const undoable = undoFor(droppedHere, session.dropped)
  const title = (id: string) => session.voices[id]?.title || 'Untitled voice'
  const current = session.current ? title(session.current) : null
  const ruledIds = ruledOut.data?.ok ? ruledOut.data.voices.map((v) => v.id) : null
  // Dropped and still ruled out: one allowed again from the list since is not counted.
  const dropped = droppedRuledOut(session.dropped, ruledIds, session.current).length

  const addById = (event: FormEvent) => {
    event.preventDefault()
    const id = voiceIdFrom(voiceId)
    if (!id) return setIdError('That is not a Fish voice id or voice URL.')
    setIdError(null)
    run({ action: 'add', body: { voice: id } }, () => {
      setDroppedHere(null)
      setVoiceId('')
    })
  }

  const card = (id: string, listed: boolean) => {
    const voice = session.voices[id]
    if (!voice) return null
    const isCurrent = id === session.current
    return (
      <VoiceCard
        key={id}
        voice={voice}
        candidate={session.matched[id] ? { voice, matched: session.matched[id] } : undefined}
        keywordCount={session.keywords.length}
        note={isCurrent ? 'Cast now' : undefined}
        playing={playing}
        toggle={toggle}
        take={takes[id] ?? null}
        recording={recorder.recording.has(id)}
        error={recorder.errors[id] ?? null}
        onRecord={() => void recorder.record(id)}
        listed={listed}
        actions={
          <>
            <button
              type="button"
              className="btn btn-drop"
              disabled={act.isPending}
              onClick={() => move(id, 'drop')}
            >
              <CrossIcon /> Drop
            </button>
            {listed ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={act.isPending}
                  onClick={() => move(id, 'unlist')}
                >
                  Unlist
                </button>
                <button
                  type="button"
                  className={`btn${isCurrent ? '' : ' btn-primary'}`}
                  disabled={cast.isPending}
                  onClick={() => setAsking({ kind: 'cast', voice: id })}
                >
                  {isCurrent ? 'Keep this voice' : `Cast as ${name}`}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-shortlist"
                disabled={act.isPending}
                onClick={() => move(id, 'shortlist')}
              >
                <CheckIcon /> Shortlist
              </button>
            )}
          </>
        }
      />
    )
  }

  const casting = asking?.kind === 'cast' ? asking.voice : null
  const keeping = casting !== null && casting === session.current

  return (
    <div className="board">
      <div className="board-bar">
        <span className="chips">
          <span className="chip chip-ok">{session.shortlist.length} shortlisted</span>
          <span className="chip">{session.toHear.length} to hear</span>
          {session.queue.length > 0 && (
            <span className="chip">{session.queue.length} more waiting</span>
          )}
          {session.dropped.length > 0 && (
            <span className="chip chip-danger">{session.dropped.length} dropped</span>
          )}
        </span>
        <span className="spacer" />
        <a
          className="btn btn-ghost"
          href={routeHref({ view: 'character', character: characterId })}
        >
          Pause
        </a>
        <button className="btn" type="button" onClick={() => setAsking({ kind: 'stop' })}>
          Stop audition…
        </button>
      </div>

      {casting !== null && (
        <Confirm
          title={
            keeping
              ? `Keep ${title(casting)} as ${name}’s voice?`
              : `Cast ${title(casting)} as ${name}?`
          }
          effects={castEffects({
            name,
            current,
            replacing: !keeping,
            recorded: view.recorded ?? [],
            titles,
            dropped,
            unheard: session.toHear.length + session.queue.length,
          })}
          onBack={() => setAsking(null)}
        >
          <button
            className="btn btn-primary"
            type="button"
            disabled={cast.isPending}
            onClick={() => cast.mutate(casting, { onSettled: () => setAsking(null) })}
          >
            {cast.isPending ? 'Casting…' : keeping ? 'Keep it' : `Cast ${title(casting)}`}
          </button>
        </Confirm>
      )}
      {asking?.kind === 'stop' && (
        <Confirm
          title="Stop without casting?"
          effects={stopEffectsFor(session, { name, lines, ruledOut: ruledIds })}
          onBack={() => setAsking(null)}
          note="To come back to it later instead, pause: the audition stays as it is."
        >
          <a className="btn" href={routeHref({ view: 'character', character: characterId })}>
            Pause instead
          </a>
          <button
            className="btn btn-primary"
            type="button"
            disabled={act.isPending}
            onClick={() => run({ action: 'discard' })}
          >
            Stop audition
          </button>
        </Confirm>
      )}

      <section className="panel board-shortlist" aria-label="Shortlist">
        <div className="section-head">
          <h2 className="section-title">Shortlist</h2>
          <span className="muted">
            {session.shortlist.length
              ? 'Cast one of them; casting ends the audition.'
              : 'Shortlist the voices worth comparing, then cast one.'}
          </span>
        </div>
        {session.shortlist.length > 0 && (
          <div className="cards">{session.shortlist.map((id) => card(id, true))}</div>
        )}
      </section>

      <section className="section" aria-label="To hear">
        <div className="section-head">
          <h2 className="section-title">To hear</h2>
          <span className="muted">
            Best match first. A dropped voice leaves the board and never comes back for {name}.
          </span>
        </div>
        {session.toHear.length > 0 ? (
          <div className="cards">{session.toHear.map((id) => card(id, false))}</div>
        ) : (
          <div className="empty-state">
            <strong>No voices to hear</strong>
            <span>Bring in more voices matching the keywords, or a specific voice.</span>
          </div>
        )}
      </section>

      <div className="panel board-more">
        <button
          className="btn"
          type="button"
          disabled={act.isPending}
          onClick={() => run({ action: 'more' }, () => setDroppedHere(null))}
        >
          Bring in more
        </button>
        <span className="spacer" />
        <form className="add-voice" onSubmit={addById}>
          <label htmlFor="voice-id" className="muted">
            Bring in a specific voice
          </label>
          <input
            id="voice-id"
            className="search"
            placeholder="Fish voice id or URL"
            value={voiceId}
            onChange={(e) => {
              setVoiceId(e.target.value)
              setIdError(null)
            }}
          />
          <button className="btn" type="submit" disabled={!voiceId.trim() || act.isPending}>
            Bring in
          </button>
        </form>
        {idError && <span className="adopt-error">{idError}</span>}
        <Failure title="The audition could not go on" result={act.data} />
        <Failure title="The voice could not be cast" result={cast.data} />
        {(act.isError || cast.isError) && (
          <span className="adopt-error">{(act.error ?? cast.error)?.message}</span>
        )}
      </div>

      {undoable && (
        <div className="toast" role="status">
          <span>
            Dropped <strong>{title(undoable)}</strong>.
            {isRuledOut(undoable, ruledIds, session.current)
              ? ` It won’t come back for ${name}.`
              : ''}
          </span>
          <button
            className="btn btn-small"
            type="button"
            disabled={act.isPending}
            onClick={() => run({ action: 'undo' }, () => setDroppedHere(null))}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
