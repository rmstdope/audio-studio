import { useState, type FormEvent } from 'react'
import type { ProjectSummary } from '../../../core/summary'
import type { AuditionText } from '../../../core/takes'
import type { CastResult } from '../../../services/sessions'
import { RuledOutPanel } from './RuledOutPanel'
import { ShortlistBoard } from './ShortlistBoard'
import { VoiceCard } from './VoiceCard'
import {
  useCandidates,
  useCast,
  useSession,
  useSessionAction,
  useSetKeywords,
  useSetPhrase,
  useSetStyle,
  useTakes,
} from '../../api'
import { CheckIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { useClipPlayer } from '../../components/useClipPlayer'
import { plural, shortTitle, tintFor, voiceLabel } from '../../format'
import { addKeyword } from '../../keywords'
import { routeHref } from '../../route'

/**
 * A character's audition: its search keywords and phrase, and either the voices in Fish's library
 * that match (with takes and samples, and a way to start an audition) or the audition's board.
 * After casting, what changed.
 */
export function AuditionView({
  summary,
  characterId,
}: {
  summary: ProjectSummary
  characterId: string
}) {
  const character = summary.characters.find((c) => c.id === characterId)
  const sessionQuery = useSession(characterId)
  const onBoard = Boolean(sessionQuery.data?.ok && sessionQuery.data.session)
  const candidates = useCandidates(characterId, sessionQuery.isSuccess && !onBoard)
  const takes = useTakes(characterId)
  const start = useSessionAction(characterId)
  const cast = useCast(characterId)
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
  const result = candidates.data
  const ok = result?.ok ? result : null
  const takeProps = (voice: string) => ({
    take: ok?.takes[voice] ?? null,
    recording: takes.recording.has(voice),
    error: takes.errors[voice] ?? null,
    onRecord: () => void takes.record(voice),
  })
  // The current voice and the top of the list: the voices an audition would start with.
  const startVoices = ok
    ? [
        ...(ok.current ? [ok.current.id] : []),
        ...ok.candidates.slice(0, ok.perRound).map((c) => c.voice.id),
      ]
    : []
  const toRecord = startVoices.filter((v) => !ok?.takes[v] && !takes.recording.has(v))
  const view = sessionQuery.data?.ok ? sessionQuery.data : null
  const board = view?.session ? { ...view, session: view.session } : null
  const casted = cast.data?.ok ? cast.data : null
  const phrase = board?.audition ?? ok?.audition ?? null
  const started = start.data && !start.data.ok ? start.data : null

  return (
    <>
      <header className="page-header">
        <div className="audition-who">
          <div className="avatar" style={tintFor(character.id)} aria-hidden="true">
            {character.name.charAt(0)}
          </div>
          <div>
            <span className="crumbs">
              <a href={routeHref({ view: 'characters' })}>Characters</a> / Audition
            </span>
            <h1>{character.name}</h1>
            <span className="muted">
              {character.appearances.length
                ? character.appearances
                    .map((a) => `${titles.get(a.part) ?? a.part} (${plural(a.lines, 'line')})`)
                    .join(' · ')
                : 'No lines yet'}{' '}
              · the cast voice is used in every {summary.partLabel.toLowerCase()}
            </span>
          </div>
        </div>
      </header>

      <div className="audition">
        <aside className="audition-brief panel">
          <KeywordsEditor characterId={character.id} keywords={character.keywords} />
          {phrase && <PhraseEditor characterId={character.id} audition={phrase} />}
          <StyleEditor characterId={character.id} style={character.style} />
          {result?.ok && (
            <div className="brief-item">
              <span className="label">Language</span>
              <span className="mono">{result.language}</span>
            </div>
          )}
          <RuledOutPanel characterId={character.id} name={character.name} />
        </aside>

        <section className="audition-main" aria-label="Candidates">
          {casted && <CastBanner result={casted} summary={summary} name={character.name} />}
          {sessionQuery.isError ? (
            <p className="panel muted">Could not load the audition: {sessionQuery.error.message}</p>
          ) : board ? (
            <ShortlistBoard
              characterId={character.id}
              name={character.name}
              lines={character.totalLines}
              view={board}
              playing={playing}
              toggle={toggle}
              cast={cast}
              titles={titles}
            />
          ) : (
            <>
              {result?.ok && result.current && (
                <div className="section">
                  <h2 className="section-title">Current voice</h2>
                  <VoiceCard
                    voice={result.current}
                    playing={playing}
                    toggle={toggle}
                    note="Cast now"
                    {...takeProps(result.current.id)}
                  />
                </div>
              )}
              {!result?.ok && character.voice && (
                <p className="muted">
                  Current voice: <span className="mono">{voiceLabel(character)}</span>
                </p>
              )}

              <div className="section">
                <div className="section-head">
                  <h2 className="section-title">Candidates</h2>
                  {result?.ok && result.candidates.length > 0 && (
                    <span className="muted">
                      {plural(result.candidates.length, 'voice')} matching the keywords, best first
                    </span>
                  )}
                  {startVoices.length > 0 && (
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={start.isPending || sessionQuery.isPending}
                      onClick={() => {
                        cast.reset()
                        start.mutate({ action: 'start' })
                      }}
                      title="The current voice on the shortlist, the top voices to hear: drop and shortlist, then cast one"
                    >
                      {start.isPending ? 'Starting…' : 'Start audition'}
                    </button>
                  )}
                  {startVoices.length > 0 && (
                    <button
                      className="btn section-action"
                      type="button"
                      disabled={toRecord.length === 0}
                      onClick={() => toRecord.forEach((voice) => void takes.record(voice))}
                      title="Each voice says the audition phrase in the character’s style (free model)"
                    >
                      {takes.recording.size
                        ? `Recording ${takes.recording.size}…`
                        : toRecord.length
                          ? `Record ${plural(toRecord.length, 'missing take')}`
                          : 'Top voices recorded'}
                    </button>
                  )}
                </div>
                {candidates.isPending ? (
                  <p className="panel muted">Searching Fish Audio’s library…</p>
                ) : candidates.isError ? (
                  <p className="panel muted">Could not search: {candidates.error.message}</p>
                ) : result && !result.ok && 'problems' in result && !('file' in result) ? (
                  <Problems title="The cast could not be read" problems={result.problems} />
                ) : !result || !result.ok ? (
                  <div className="empty-state">
                    <strong>
                      {result && 'reason' in result && result.reason === 'no-key'
                        ? 'No Fish Audio API key'
                        : 'Fish Audio could not be searched'}
                    </strong>
                    <span>
                      {result && 'message' in result
                        ? result.message
                        : 'The project file needs fixing first.'}
                    </span>
                  </div>
                ) : result.keywords.length === 0 ? (
                  <div className="empty-state">
                    <strong>Add keywords to search for voices</strong>
                    <span>
                      Describe the voice: age, gender, accent, character, e.g. “elderly female”,
                      “warm”.
                    </span>
                  </div>
                ) : result.candidates.length === 0 ? (
                  <div className="empty-state">
                    <strong>No voices match these keywords</strong>
                    <span>Try fewer or broader keywords.</span>
                  </div>
                ) : (
                  <div className="cards">
                    {result.candidates.map((candidate) => (
                      <VoiceCard
                        key={candidate.voice.id}
                        voice={candidate.voice}
                        candidate={candidate}
                        keywordCount={result.keywords.length}
                        playing={playing}
                        toggle={toggle}
                        {...takeProps(candidate.voice.id)}
                      />
                    ))}
                  </div>
                )}
                {started && 'message' in started && (
                  <span className="adopt-error">{started.message}</span>
                )}
                {started && 'problems' in started && (
                  <Problems title="The audition could not start" problems={started.problems} />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  )
}

/** What casting did: the new voice, and the lines it made stale, per part. */
function CastBanner({
  result,
  summary,
  name,
}: {
  result: Extract<NonNullable<CastResult>, { ok: true }>
  summary: ProjectSummary
  name: string
}) {
  const titles = new Map(summary.parts.map((p) => [p.id, p.title]))
  const lines = result.stale.reduce((sum, a) => sum + a.lines, 0)
  return (
    <div className="cast-banner" role="status">
      <CheckIcon />
      <div className="cast-text">
        <strong>
          {result.changed
            ? `${result.voice.name} is now ${name}’s voice`
            : `${name} keeps ${result.voice.name}`}
        </strong>
        <span>
          {result.changed
            ? `Saved to the cast for every ${summary.partLabel.toLowerCase()}. ${plural(lines, 'line')} ${lines === 1 ? 'is' : 'are'} now stale and need recording again.`
            : 'Nothing changed in the cast.'}
        </span>
        {result.stale.length > 0 && (
          <span className="chips">
            {result.stale.map((a) => (
              <a key={a.part} className="chip" href={routeHref({ view: 'lines', part: a.part })}>
                {shortTitle(titles.get(a.part) ?? a.part)}: {plural(a.lines, 'line')}
              </a>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

function KeywordsEditor({ characterId, keywords }: { characterId: string; keywords: string[] }) {
  const save = useSetKeywords(characterId)
  const [draft, setDraft] = useState('')
  const current = save.isPending && save.variables ? save.variables : keywords

  const add = (event: FormEvent) => {
    event.preventDefault()
    const next = addKeyword(current, draft)
    if (next) save.mutate(next)
    setDraft('')
  }

  return (
    <form className="brief-item" onSubmit={add}>
      <label className="label" htmlFor="keyword">
        Search keywords
      </label>
      <div className="chips">
        {current.map((keyword) => (
          <span key={keyword} className="keyword">
            {keyword}
            <button
              type="button"
              aria-label={`Remove ${keyword}`}
              onClick={() => save.mutate(current.filter((k) => k !== keyword))}
            >
              ×
            </button>
          </span>
        ))}
        {current.length === 0 && <span className="muted">None yet</span>}
      </div>
      <div className="keyword-add">
        <input
          id="keyword"
          className="search"
          placeholder="e.g. elderly female"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!draft.trim()}>
          Add
        </button>
      </div>
      <span className="muted brief-hint">
        Saved in the cast. Each keyword is searched, and voices are ranked by how many they match.
      </span>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The keywords could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}

function PhraseEditor({ characterId, audition }: { characterId: string; audition: AuditionText }) {
  const save = useSetPhrase(characterId)
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? audition.phrase
  const changed = draft !== null && draft.trim() !== audition.phrase

  return (
    <form
      className="brief-item"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(text.trim() || null, { onSuccess: (result) => result.ok && setDraft(null) })
      }}
    >
      <label className="label" htmlFor="phrase">
        Audition phrase · {audition.own ? 'this character’s own' : 'the project’s standard'}
      </label>
      <textarea
        id="phrase"
        className="phrase"
        rows={3}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="keyword-add">
        <button className="btn" type="submit" disabled={!changed || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save phrase'}
        </button>
        {audition.own && (
          <button
            className="btn"
            type="button"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(null, { onSuccess: (result) => result.ok && setDraft(null) })
            }
          >
            Use the standard phrase
          </button>
        )}
      </div>
      <span className="muted brief-hint">
        A changed phrase needs new takes. Sent to Fish as:{' '}
        <span className="mono">{audition.spoken}</span>
      </span>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The phrase could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}

/**
 * A character's style cue, saved in the cast: how every line without its own cue is said, and
 * the audition takes too.
 */
function StyleEditor({ characterId, style }: { characterId: string; style: string }) {
  const save = useSetStyle(characterId)
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? style
  const changed = draft !== null && draft.trim() !== style

  return (
    <form
      className="brief-item"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(text, { onSuccess: (result) => result.ok && setDraft(null) })
      }}
    >
      <label className="label" htmlFor="style">
        Style cue
      </label>
      <input
        id="style"
        className="style-input mono"
        placeholder="[warm, gentle, a little worried]"
        value={text}
        onChange={(e) => {
          // A new draft: what went wrong with the last one no longer applies.
          if (save.data || save.error) save.reset()
          setDraft(e.target.value)
        }}
      />
      <div className="keyword-add">
        <button className="btn" type="submit" disabled={!changed || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save style'}
        </button>
      </div>
      <span className="muted brief-hint">
        Saved in the cast. Every line without its own cue is said this way, and so are the audition
        takes: recorded lines show as stale until generated again.
      </span>
      {save.data && !save.data.ok && 'problems' in save.data && (
        <Problems title="The style could not be saved" problems={save.data.problems} />
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}
