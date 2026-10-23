import { useState, type FormEvent } from 'react'
import type { ProjectSummary } from '../../../core/summary'
import type { Candidate, Voice } from '../../../core/voiceSearch'
import { useCandidates, useSetKeywords } from '../../api'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { useClipPlayer } from '../../components/useClipPlayer'
import { compact, plural, shortTitle, tintFor, voiceLabel } from '../../format'
import { routeHref } from '../../route'

/**
 * A character's audition: its search keywords, and the voices in Fish's library that match them,
 * each with Fish's own sample to listen to. (Takes in the character's voice, rounds and casting
 * come next.)
 */
export function AuditionView({
  summary,
  characterId,
}: {
  summary: ProjectSummary
  characterId: string
}) {
  const character = summary.characters.find((c) => c.id === characterId)
  const candidates = useCandidates(characterId)
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
          <div className="brief-item">
            <span className="label">Style cue</span>
            {character.style ? (
              <span className="style-cue">{character.style}</span>
            ) : (
              <span className="muted">No style cue</span>
            )}
          </div>
          {result?.ok && (
            <div className="brief-item">
              <span className="label">Language</span>
              <span className="mono">{result.language}</span>
            </div>
          )}
        </aside>

        <section className="audition-main" aria-label="Candidates">
          {result?.ok && result.current && (
            <div className="section">
              <h2 className="section-title">Current voice</h2>
              <VoiceCard voice={result.current} playing={playing} toggle={toggle} note="Cast now" />
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
            </div>
            {candidates.isPending ? (
              <p className="panel muted">Searching Fish Audio’s library…</p>
            ) : candidates.isError ? (
              <p className="panel muted">Could not search: {candidates.error.message}</p>
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
                  Describe the voice: age, gender, accent, character, e.g. “elderly female”, “warm”.
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
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

function KeywordsEditor({ characterId, keywords }: { characterId: string; keywords: string[] }) {
  const save = useSetKeywords(characterId)
  const [draft, setDraft] = useState('')
  const current = save.isPending && save.variables ? save.variables : keywords

  const add = (event: FormEvent) => {
    event.preventDefault()
    const word = draft.trim()
    const known = current.some((k) => k.toLowerCase() === word.toLowerCase())
    if (!word || known) return setDraft('')
    save.mutate([...current, word])
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
        <span className="adopt-error">The cast file has problems; fix them first.</span>
      )}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}

function VoiceCard({
  voice,
  candidate,
  keywordCount,
  playing,
  toggle,
  note,
}: {
  voice: Voice
  candidate?: Candidate
  keywordCount?: number
  playing: string | null
  toggle: (id: string, url: string) => void
  note?: string
}) {
  const sample = voice.sample
  return (
    <article className="card voice-card" aria-label={voice.title}>
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
      <div className="voice-sample">
        {sample ? (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label={playing === voice.id ? 'Stop' : `Play Fish’s sample of ${voice.title}`}
              onClick={() => toggle(voice.id, sample.audio)}
            >
              {playing === voice.id ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span className="muted sample-text" title={sample.text}>
              Fish sample{sample.text ? `: “${sample.text}”` : ''}
            </span>
          </>
        ) : (
          <span className="muted">No sample from Fish</span>
        )}
      </div>
      <span className="mono muted voice-id">{voice.id}</span>
    </article>
  )
}
