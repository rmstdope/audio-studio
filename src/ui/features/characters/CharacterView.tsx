import { useEffect, useRef, useState } from 'react'
import type { AuditionSession } from '../../../core/audition'
import type { SittingView } from '../../../core/sitting'
import { usd } from '../../../core/spend'
import { sharesVoiceWith, type CharacterSummary, type ProjectSummary } from '../../../core/summary'
import {
  clipUrl,
  takeUrl,
  useCharacterVoice,
  usePart,
  useParts,
  useRuledOut,
  useSession,
  useSessionAction,
  useSitting,
  useSittingActions,
  useTakes,
  type Voiced,
} from '../../api'
import { sampleClip, stopEffectsFor, takeClip } from '../../board'
import { Confirm } from '../../components/Confirm'
import { Failure } from '../../components/Failure'
import { AlertIcon, HeadphonesIcon, PauseIcon, PlayIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { StatusBar } from '../../components/StatusBar'
import { useClipPlayer } from '../../components/useClipPlayer'
import { compact, plural, separatorBefore, shortTitle, tintFor, voiceLabel } from '../../format'
import { routeHref } from '../../route'
import { inGameState, recordedLinesOf } from '../../inGame'
import type { Clip } from '../../player'
import { linesSummary, speakerCounts, STATUS } from '../../status'
import { isAbout, takeToRecord } from '../../takes'
import { voiceUrl } from '../../voiceId'
import { RuledOutPanel } from '../audition/RuledOutPanel'
import { SittingBox, sittingFailure } from '../audition/SittingBox'
import { KeywordsEditor, PhraseEditor, SpeedEditor, StyleEditor } from './BriefEditors'

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
  const session = useSession(characterId, Boolean(character))
  const voice = useCharacterVoice(characterId, character?.voice ?? null, Boolean(character))
  const start = useSessionAction(characterId)
  const sittingQuery = useSitting(characterId, Boolean(character))
  const sittingActions = useSittingActions(characterId)
  // Which question is open: starting an audition on a paid model, or carrying one on.
  const [asking, setAsking] = useState<'start' | 'resume' | null>(null)
  const player = useClipPlayer()
  const { playing, toggle } = player

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
  const answer = voice.data?.ok && isAbout(voice.data, character.voice) ? voice.data : null
  const audition = routeHref({ view: 'audition', character: character.id })
  const money = sittingQuery.data?.ok ? sittingQuery.data : null

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
          // On a paid model, with no money left in this sitting, Resume asks for more first.
          money?.paid && !money.sitting ? (
            <button className="btn btn-primary" type="button" onClick={() => setAsking('resume')}>
              <HeadphonesIcon /> Resume…
            </button>
          ) : (
            <a className="btn btn-primary" href={audition}>
              <HeadphonesIcon /> Resume audition
            </a>
          )
        ) : (
          // Only once it is known that no audition is going on: starting would replace one.
          view && (
            <button
              className="btn btn-primary"
              type="button"
              // While the audition is read again, one may have been started elsewhere.
              disabled={start.isPending || session.isFetching || !money}
              onClick={() =>
                money?.paid
                  ? setAsking('start')
                  : start.mutate(
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
      {money && asking && (
        <SittingBox
          kind={asking}
          view={money}
          busy={start.isPending || sittingActions.resume.isPending}
          failure={
            asking === 'start'
              ? start.data && !start.data.ok && 'message' in start.data
                ? start.data.message
                : undefined
              : sittingFailure(sittingActions.resume.data)
          }
          onPay={(amount) =>
            asking === 'start'
              ? start.mutate(
                  { action: 'start', body: { spendUpTo: amount } },
                  { onSuccess: (result) => result.ok && (window.location.hash = audition) },
                )
              : sittingActions.resume.mutate(amount, {
                  onSuccess: (answer) => answer.ok && (window.location.hash = audition),
                })
          }
          onCancel={() => setAsking(null)}
        />
      )}
      <Failure title="The audition could not start" result={asking ? undefined : start.data} />
      {start.isError && <span className="adopt-error">{start.error.message}</span>}
      {voice.isError && (
        <span className="adopt-error">Could not load the voice: {voice.error.message}</span>
      )}
      {voice.data && !voice.data.ok && 'problems' in voice.data && (
        <Problems title="The cast could not be read" problems={voice.data.problems} />
      )}

      <div className="audition">
        <div className="audition-main">
          <VoicePanel
            character={character}
            answer={answer}
            playing={playing}
            toggle={toggle}
            sharedWith={sharesVoiceWith(summary.characters, character.id)}
            paidModel={money?.paid ? money.model : null}
          />
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
          {character.appearances.length > 0 && (
            <InTheGame
              speaker={character.id}
              name={character.name}
              parts={character.appearances.map((a) => ({
                id: a.part,
                title: titles.get(a.part) ?? a.part,
              }))}
              player={player}
            />
          )}
        </div>

        <aside className="audition-brief">
          {inProgress && (
            <InProgress
              characterId={character.id}
              name={character.name}
              lines={character.totalLines}
              session={inProgress}
              href={audition}
              money={money}
              onResume={() => setAsking('resume')}
            />
          )}
          <section className="panel brief-panel" aria-label="Delivery">
            <StyleEditor characterId={character.id} style={character.style} />
            <SpeedEditor
              characterId={character.id}
              speed={character.speed}
              projectSpeed={summary.speed}
            />
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
  sharedWith,
  paidModel,
}: {
  character: CharacterSummary
  /** What the server says about the voice cast now; null until it has. */
  answer: Voiced | null
  playing: string | null
  toggle: (id: string, url: string) => void
  /** The other characters cast with this voice. */
  sharedWith: CharacterSummary[]
  /** The audition model when it is a paid one: the cast voice's take is on the free model all the same. */
  paidModel: string | null
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
      {sharedWith.length > 0 && (
        <p className="status-note shared-voice">
          <AlertIcon />
          <span>
            Also the voice of{' '}
            {sharedWith.map((other, i) => (
              <span key={other.id}>
                {separatorBefore(i, sharedWith.length)}
                <a href={routeHref({ view: 'character', character: other.id })}>{other.name}</a>
              </span>
            ))}
            . Characters in one voice are hard to tell apart in a scene.
          </span>
        </p>
      )}
      <div className="voice-listen">
        <div className="listen-box">
          {take ? (
            <button
              type="button"
              className="icon-btn take-play"
              aria-label={playing === takeClip(id) ? 'Stop' : 'Play the take'}
              onClick={() => toggle(takeClip(id), takeUrl(take))}
            >
              {playing === takeClip(id) ? <PauseIcon /> : <PlayIcon />}
            </button>
          ) : (
            <button
              className="btn btn-small"
              type="button"
              disabled={recorder.recording.has(id) || !answer || answer.lookup?.reason === 'no-key'}
              onClick={() => void record(id)}
            >
              {recorder.recording.has(id) ? 'Recording…' : 'Record'}
            </button>
          )}
          <span>
            <strong>Take {paidModel && <span className="chip">free model</span>}</strong>
            <span className="muted">The audition phrase, in {character.name}’s style</span>
            {paidModel && (
              <span className="muted">Recorded with s2.1-pro-free. Auditions use {paidModel}.</span>
            )}
          </span>
        </div>
        <div className="listen-box">
          {sample && (
            <button
              type="button"
              className="icon-btn"
              aria-label={playing === sampleClip(id) ? 'Stop' : 'Play Fish’s sample'}
              onClick={() => toggle(sampleClip(id), sample.audio)}
            >
              {playing === sampleClip(id) ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
          <span>
            <strong>Fish sample</strong>
            <span className="muted sample-text" title={sample?.text}>
              {!answer
                ? '…'
                : sample
                  ? sample.text
                    ? `“${sample.text}”`
                    : 'Fish’s own clip'
                  : 'None from Fish'}
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

/**
 * The character's recorded lines, as the game plays them: each with its part and cue, played one
 * by one or all in turn, the first few shown until asked for all.
 */
function InTheGame({
  speaker,
  name,
  parts,
  player,
}: {
  speaker: string
  name: string
  parts: { id: string; title: string }[]
  player: ReturnType<typeof useClipPlayer>
}) {
  const loaded = useParts(parts.map((p) => p.id))
  const [all, setAll] = useState(false)
  const listed = parts.map((p, i) => {
    const query = loaded[i]
    const data = query?.data
    const state = data?.ok ? 'loaded' : query?.isPending ? 'pending' : 'failed'
    return { ...p, state, lines: data?.ok ? data.part.lines : null } as const
  })
  const lines = recordedLinesOf(listed, speaker)
  const view = inGameState(listed, lines, all)
  const clips: Clip[] = lines.map((l) => ({ id: l.id, url: clipUrl(l.part, l.file) }))
  return (
    <section className="panel in-game" aria-label="Hear it in the game">
      <div className="section-head">
        <h2 className="section-title">Hear it in the game</h2>
        <span className="muted">
          {lines.length > 0 && `${plural(lines.length, 'recorded line')}, as the game plays them`}
          {lines.length > 0 && view.loading && ' · '}
          {view.loading}
          {view.empty && `None of ${name}’s lines is recorded yet.`}
        </span>
      </div>
      {view.failed.length > 0 && (
        <span className="adopt-error">
          Could not load the lines of{' '}
          {view.failed.map((p, i) => (
            <span key={p.id}>
              {i > 0 && (i === view.failed.length - 1 ? ' and ' : ', ')}
              <a href={routeHref({ view: 'lines', part: p.id })}>{p.title}</a>
            </span>
          ))}
          ; they are left out here. Open {view.failed.length === 1 ? 'it' : 'them'} to see why.
        </span>
      )}
      {view.shown.length > 0 && (
        <ol className="in-game-lines">
          {view.shown.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className="icon-btn"
                aria-label={player.playing === l.id ? 'Stop' : `Play “${l.text}”`}
                onClick={() => player.toggle(l.id, clipUrl(l.part, l.file))}
              >
                {player.playing === l.id ? <PauseIcon /> : <PlayIcon />}
              </button>
              <span className="in-game-text">
                <span>{l.text}</span>
                <span className="muted mono">
                  {l.title}
                  {l.cue ? ` · ${l.cue}` : ''}
                </span>
              </span>
              <span
                className="badge"
                style={{ color: STATUS[l.status].color, background: STATUS[l.status].bg }}
              >
                {STATUS[l.status].label}
              </span>
            </li>
          ))}
        </ol>
      )}
      {lines.length > 0 && (
        <div className="in-game-actions">
          {(view.more > 0 || all) && (
            <button className="btn btn-ghost" type="button" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `All ${lines.length} lines`}
            </button>
          )}
          <button
            className="btn"
            type="button"
            disabled={!player.inTurn && !view.canPlayAll}
            onClick={() => {
              if (player.inTurn) return player.stop()
              // Every line shows while they play, and stays shown after.
              setAll(true)
              player.playInTurn(clips)
            }}
          >
            {player.inTurn ? 'Stop' : 'Play all in turn'}
          </button>
        </div>
      )}
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
  money,
  onResume,
}: {
  characterId: string
  name: string
  lines: number
  session: AuditionSession
  href: string
  /** The audition's money, once known. */
  money: SittingView | null
  /** Opens the box that asks what the audition may spend as it goes on. */
  onResume: () => void
}) {
  const act = useSessionAction(characterId)
  const ruledOut = useRuledOut(characterId)
  const [asking, setAsking] = useState(false)
  const ruledIds = ruledOut.data?.ok ? ruledOut.data.voices.map((v) => v.id) : null
  return (
    <section className="panel in-progress" aria-label="Audition in progress">
      <span className="label">Audition in progress</span>
      <span>
        {plural(session.shortlist.length, 'voice')} shortlisted, {session.toHear.length} to hear.
      </span>
      {money?.paid && session.spent > 0 && (
        <span className="muted">
          {usd(session.spent)} spent so far · {money.model}
        </span>
      )}
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
          {money?.paid && !money.sitting ? (
            <button className="btn btn-primary" type="button" onClick={onResume}>
              Resume…
            </button>
          ) : (
            <a className="btn btn-primary" href={href}>
              Resume
            </a>
          )}
        </div>
      )}
      <Failure title="The audition could not be stopped" result={act.data} />
      {act.isError && <span className="adopt-error">{act.error.message}</span>}
    </section>
  )
}
