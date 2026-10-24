import { useEffect, useRef, useState } from 'react'
import type { AuditionSession } from '../../../core/audition'
import type { CharacterSummary, ProjectSummary } from '../../../core/summary'
import type { CharacterVoiceResult } from '../../../services/auditions'
import {
  takeUrl,
  useCharacterVoice,
  usePart,
  useRuledOut,
  useSession,
  useSessionAction,
  useTakes,
} from '../../api'
import { stopEffectsFor } from '../../board'
import { Confirm } from '../../components/Confirm'
import { HeadphonesIcon, PauseIcon, PlayIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { StatusBar } from '../../components/StatusBar'
import { useClipPlayer } from '../../components/useClipPlayer'
import { compact, plural, shortTitle, tintFor, voiceLabel } from '../../format'
import { routeHref } from '../../route'
import { linesSummary, speakerCounts } from '../../status'
import { takeToRecord } from '../../takes'
import { voiceUrl } from '../../voiceId'
import { RuledOutPanel } from '../audition/RuledOutPanel'
import { KeywordsEditor, PhraseEditor, StyleEditor } from './BriefEditors'

/** A successful answer about a character's cast voice. */
type Voiced = Extract<NonNullable<CharacterVoiceResult>, { ok: true }>

/**
 * A character's page, the one place about it: its cast voice (Fish's details, its take and
 * sample), its lines per part, its delivery and casting brief, the voices ruled out for it, and
 * its audition: started, resumed or stopped from here.
 */
export function CharacterView({
  summary,
  characterId,
}: {
  summary: ProjectSummary
  characterId: string
}) {
  const character = summary.characters.find((c) => c.id === characterId)
  const session = useSession(characterId)
  const voice = useCharacterVoice(characterId, character?.voice ?? null)
  const start = useSessionAction(characterId)
  const { playing, toggle } = useClipPlayer()

  if (!character) {
    return (
      <div className="empty-state">
        <strong>No character called “{characterId}”</strong>
        <a className="btn" href={routeHref({ view: 'characters' })} style={{ alignSelf: 'center' }}>
          All characters
        </a>
      </div>
    )
  }

  const titles = new Map(summary.parts.map((p) => [p.id, shortTitle(p.title)]))
  const view = session.data?.ok ? session.data : null
  const inProgress = view?.session ?? null
  // An answer about the voice cast now: one about an earlier voice is not shown.
  const answer = voice.data?.ok && voice.data.id === character.voice ? voice.data : null
  const failed = start.data && !start.data.ok ? start.data : null
  const audition = routeHref({ view: 'audition', character: character.id })

  return (
    <>
      <header className="page-header">
        <div className="audition-who">
          <div className="avatar" style={tintFor(character.id)} aria-hidden="true">
            {character.name.charAt(0)}
          </div>
          <div>
            <span className="crumbs">
              <a href={routeHref({ view: 'characters' })}>Characters</a> / {character.name}
            </span>
            <h1>{character.name}</h1>
            <span className="muted">
              {character.appearances.length
                ? `${plural(character.totalLines, 'line')} in ${plural(character.appearances.length, summary.partLabel.toLowerCase())}`
                : 'No lines yet'}{' '}
              · one voice in every {summary.partLabel.toLowerCase()}
            </span>
          </div>
        </div>
        {inProgress ? (
          <a className="btn btn-primary" href={audition}>
            <HeadphonesIcon /> Resume audition
          </a>
        ) : (
          // Only once it is known that no audition is going on: starting would replace one.
          view && (
            <button
              className="btn btn-primary"
              type="button"
              disabled={start.isPending}
              onClick={() =>
                start.mutate(
                  { action: 'start' },
                  { onSuccess: (result) => result.ok && (window.location.hash = audition) },
                )
              }
            >
              <HeadphonesIcon /> {start.isPending ? 'Starting…' : 'Start audition'}
            </button>
          )
        )}
      </header>
      {session.isError && (
        <span className="adopt-error">Could not read the audition: {session.error.message}</span>
      )}
      {session.data && !session.data.ok && 'problems' in session.data && (
        <Problems title="The audition could not be read" problems={session.data.problems} />
      )}
      {failed && 'problems' in failed && (
        <Problems title="The audition could not start" problems={failed.problems} />
      )}
      {failed && 'message' in failed && <span className="adopt-error">{failed.message}</span>}
      {start.isError && <span className="adopt-error">{start.error.message}</span>}
      {voice.isError && (
        <span className="adopt-error">Could not load the voice: {voice.error.message}</span>
      )}
      {voice.data && !voice.data.ok && 'problems' in voice.data && (
        <Problems title="The cast could not be read" problems={voice.data.problems} />
      )}

      <div className="audition">
        <div className="audition-main">
          <VoicePanel character={character} answer={answer} playing={playing} toggle={toggle} />
          <section className="panel character-lines" aria-label="Lines">
            <div className="section-head">
              <h2 className="section-title">Lines</h2>
            </div>
            {character.appearances.length ? (
              character.appearances.map((a) => (
                <PartLines
                  key={a.part}
                  partId={a.part}
                  title={titles.get(a.part) ?? a.part}
                  speaker={character.id}
                  lines={a.lines}
                />
              ))
            ) : (
              <span className="muted">
                {character.name} has no lines in any {summary.partLabel.toLowerCase()} yet.
              </span>
            )}
          </section>
        </div>

        <aside className="audition-brief">
          {inProgress && (
            <InProgress
              characterId={character.id}
              name={character.name}
              lines={character.totalLines}
              session={inProgress}
              href={audition}
            />
          )}
          <section className="panel brief-panel" aria-label="Delivery">
            <StyleEditor characterId={character.id} style={character.style} />
          </section>
          <section className="panel brief-panel" aria-label="Casting brief">
            <KeywordsEditor characterId={character.id} keywords={character.keywords} />
            {answer && <PhraseEditor characterId={character.id} audition={answer.audition} />}
            {answer && (
              <div className="brief-item">
                <span className="label">Language</span>
                <span className="mono">{answer.language}</span>
              </div>
            )}
          </section>
          <section className="panel brief-panel" aria-label="Ruled out">
            <RuledOutPanel characterId={character.id} name={character.name} />
          </section>
        </aside>
      </div>
    </>
  )
}

/**
 * The cast voice: Fish's details of it, its take of the audition phrase (recorded by itself if
 * missing, as the audition model is free) and Fish's sample, its id and its page on Fish.
 */
function VoicePanel({
  character,
  answer,
  playing,
  toggle,
}: {
  character: CharacterSummary
  /** What the server says about the voice cast now; null until it has. */
  answer: Voiced | null
  playing: string | null
  toggle: (id: string, url: string) => void
}) {
  const recorder = useTakes(character.id)
  const id = character.voice
  // The take is asked for once per phrase, so one the page cannot show is not asked again.
  const asked = useRef(new Set<string>())
  const wanted = answer ? takeToRecord(answer, id) : null
  const { record } = recorder
  useEffect(() => {
    if (!wanted || !id || asked.current.has(wanted)) return
    asked.current.add(wanted)
    void record(id)
  }, [wanted, id, record])

  if (!id) {
    return (
      <section className="panel voice-panel" aria-label="Voice">
        <span className="label">Voice</span>
        <strong>No voice yet</strong>
        <span className="muted">
          Start an audition to find one. Until then {character.name}’s lines cannot be recorded.
        </span>
      </section>
    )
  }
  const voice = answer?.voice ?? null
  const sample = voice?.sample ?? null
  const take = answer?.take ?? null
  return (
    <section className="panel voice-panel" aria-label="Voice">
      <div className="section-head">
        <span className="label">Voice</span>
        <span className="chip chip-ok">Cast</span>
      </div>
      <div className="voice-name">
        <strong>{voice?.title || voiceLabel(character)}</strong>
        {voice && (
          <span className="muted">
            {voice.author ? `by ${voice.author} · ` : ''}
            {compact(voice.uses)} uses · {compact(voice.likes)} likes
          </span>
        )}
      </div>
      {voice?.description && <p className="voice-description">{voice.description}</p>}
      {voice && voice.tags.length > 0 && (
        <div className="chips">
          {voice.tags.slice(0, 8).map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      )}
      {answer?.lookup && (
        <span className="muted">
          Fish Audio could not give this voice’s details: {answer.lookup.message}
        </span>
      )}
      <div className="voice-listen">
        <div className="listen-box">
          {take ? (
            <button
              type="button"
              className="icon-btn take-play"
              aria-label={playing === `take:${id}` ? 'Stop' : 'Play the take'}
              onClick={() => toggle(`take:${id}`, takeUrl(take))}
            >
              {playing === `take:${id}` ? <PauseIcon /> : <PlayIcon />}
            </button>
          ) : (
            <button
              className="btn btn-small"
              type="button"
              disabled={recorder.recording.has(id) || !answer}
              onClick={() => void record(id)}
            >
              {recorder.recording.has(id) ? 'Recording…' : 'Record'}
            </button>
          )}
          <span>
            <strong>Take</strong>
            <span className="muted">The audition phrase, in {character.name}’s style</span>
          </span>
        </div>
        <div className="listen-box">
          {sample && (
            <button
              type="button"
              className="icon-btn"
              aria-label={playing === `sample:${id}` ? 'Stop' : 'Play Fish’s sample'}
              onClick={() => toggle(`sample:${id}`, sample.audio)}
            >
              {playing === `sample:${id}` ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
          <span>
            <strong>Fish sample</strong>
            <span className="muted sample-text" title={sample?.text}>
              {sample ? (sample.text ? `“${sample.text}”` : 'Fish’s own clip') : 'None from Fish'}
            </span>
          </span>
        </div>
      </div>
      {recorder.errors[id] && <span className="adopt-error">{recorder.errors[id]}</span>}
      <div className="voice-foot">
        <span className="mono muted voice-id">{id}</span>
        <a href={voiceUrl(id)} target="_blank" rel="noreferrer">
          Open on Fish Audio ↗
        </a>
      </div>
    </section>
  )
}

/** One part's lines of the character: how many, how they stand, and a link to the part's lines. */
function PartLines({
  partId,
  title,
  speaker,
  lines,
}: {
  partId: string
  title: string
  speaker: string
  lines: number
}) {
  const part = usePart(partId)
  const loaded = part.data?.ok ? part.data.part : null
  const counts = loaded ? speakerCounts(loaded.lines, speaker) : null
  return (
    <a className="part-lines" href={routeHref({ view: 'lines', part: partId })}>
      <strong>{title}</strong>
      {counts ? <StatusBar counts={counts} height={6} /> : <span className="muted">…</span>}
      <span className="muted">
        {plural(lines, 'line')}
        {counts ? ` · ${linesSummary(counts)}` : ''}
      </span>
    </a>
  )
}

/** The audition in progress: how far it got, Resume, and Stop after saying what it means. */
function InProgress({
  characterId,
  name,
  lines,
  session,
  href,
}: {
  characterId: string
  name: string
  lines: number
  session: AuditionSession
  href: string
}) {
  const act = useSessionAction(characterId)
  const ruledOut = useRuledOut(characterId)
  const [asking, setAsking] = useState(false)
  const ruledIds = ruledOut.data?.ok ? ruledOut.data.voices.map((v) => v.id) : null
  const failed = act.data && !act.data.ok ? act.data : null
  return (
    <section className="panel in-progress" aria-label="Audition in progress">
      <span className="label">Audition in progress</span>
      <span>
        {plural(session.shortlist.length, 'voice')} shortlisted, {session.toHear.length} to hear.
      </span>
      {asking ? (
        <Confirm
          title="Stop without casting?"
          effects={stopEffectsFor(session, { name, lines, ruledOut: ruledIds })}
          back="Keep it"
          onBack={() => setAsking(false)}
        >
          <button
            className="btn btn-primary"
            type="button"
            disabled={act.isPending}
            onClick={() => act.mutate({ action: 'discard' })}
          >
            Stop audition
          </button>
        </Confirm>
      ) : (
        <div className="confirm-actions">
          <button className="btn btn-ghost" type="button" onClick={() => setAsking(true)}>
            Stop…
          </button>
          <a className="btn btn-primary" href={href}>
            Resume
          </a>
        </div>
      )}
      {failed && 'problems' in failed && (
        <Problems title="The audition could not be stopped" problems={failed.problems} />
      )}
      {failed && 'message' in failed && <span className="adopt-error">{failed.message}</span>}
      {act.isError && <span className="adopt-error">{act.error.message}</span>}
    </section>
  )
}
