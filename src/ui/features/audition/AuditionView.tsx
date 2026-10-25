import type { ProjectSummary } from '../../../core/summary'
import {
  castSaved,
  isMultilingual,
  languageShown,
  nameOf,
  queryLanguage,
} from '../../castLanguages'
import type { CastResult } from '../../../services/sessions'
import { useCast, useParts, useSession, useSessionAction } from '../../api'
import { CheckIcon } from '../../components/icons'
import { Failure } from '../../components/Failure'
import { useClipPlayer } from '../../components/useClipPlayer'
import { plural, shortTitle } from '../../format'
import { routeHref } from '../../route'
import { PhraseEditor, StyleEditor } from '../characters/BriefEditors'
import { ShortlistBoard } from './ShortlistBoard'

/**
 * A character's audition: the board while one is in progress, with the phrase and style the takes
 * are recorded with beside it; after casting, what changed; with none, a way to start one.
 */
export function AuditionView({
  summary,
  characterId,
  asked,
}: {
  summary: ProjectSummary
  characterId: string
  /** The language the address names, if any. */
  asked?: string
}) {
  const character = summary.characters.find((c) => c.id === characterId)
  const several = isMultilingual(summary.languages)
  const language = languageShown(summary.languages, asked)
  const languageName = nameOf(summary.languages, language)
  const inLanguage = several ? { id: language, name: languageName } : null
  const asking = queryLanguage(summary.languages, asked)
  const sessionQuery = useSession(characterId, Boolean(character), asking)
  const start = useSessionAction(characterId, asking)
  const cast = useCast(characterId, asking)
  const parts = character?.languages[language]?.appearances ?? []
  const loadedParts = useParts(
    parts.map((a) => a.part),
    asking,
  )
  const lineTexts = [
    ...new Set(
      loadedParts.flatMap((query) =>
        query.data?.ok
          ? query.data.part.lines
              .filter((l) => l.speaker === characterId && l.text)
              .map((l) => l.text)
          : [],
      ),
    ),
  ]
  const { playing, toggle, stop } = useClipPlayer()

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

  const page = routeHref({
    view: 'character',
    character: character.id,
    ...(several ? { language } : {}),
  })
  const titles = new Map(summary.parts.map((p) => [p.id, shortTitle(p.title)]))
  const view = sessionQuery.data?.ok ? sessionQuery.data : null
  const board = view?.session ? { ...view, session: view.session } : null
  const casted = cast.data?.ok ? cast.data : null

  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">
            <a href={routeHref({ view: 'characters' })}>Characters</a> /{' '}
            <a href={page}>{character.name}</a> / Audition
          </span>
          <h1>
            Audition for {character.name}
            {inLanguage ? ` in ${languageName}` : ''}
          </h1>
          <span className="muted">
            Each voice says the phrase in {character.name}’s style, with the free audition model.
            Takes record by themselves.
          </span>
        </div>
      </header>

      <div className="audition">
        {board && (
          <aside className="audition-brief panel">
            <div className="brief-item">
              <span className="label">Searching for</span>
              <div className="chips">
                {board.session.keywords.map((k) => (
                  <span key={k} className="chip">
                    {k}
                  </span>
                ))}
                {board.session.keywords.length === 0 && <span className="muted">No keywords</span>}
              </div>
              <span className="muted brief-hint">
                The keywords the audition started with. Change them on{' '}
                <a href={page}>{character.name}’s page</a> for the next one.
              </span>
            </div>
            {board.audition && (
              <PhraseEditor
                characterId={character.id}
                characterName={character.name}
                audition={board.audition}
                language={inLanguage?.id}
                languageName={inLanguage?.name}
                lines={lineTexts}
              />
            )}
            <StyleEditor characterId={character.id} style={character.style} />
          </aside>
        )}

        <section className="audition-main" aria-label="Audition">
          {casted && (
            <CastBanner
              result={casted}
              summary={summary}
              name={character.name}
              language={inLanguage?.id}
            />
          )}
          {sessionQuery.isError ? (
            <p className="panel muted">Could not load the audition: {sessionQuery.error.message}</p>
          ) : board ? (
            <ShortlistBoard
              characterId={character.id}
              character={character}
              languages={summary.languages}
              language={inLanguage}
              name={character.name}
              lines={character.languages[language]?.totalLines ?? character.totalLines}
              view={board}
              playing={playing}
              toggle={toggle}
              stop={stop}
              cast={cast}
              titles={titles}
            />
          ) : sessionQuery.isPending ? (
            <p className="muted">Opening the audition…</p>
          ) : !view ? (
            <Failure title="The audition could not be read" result={sessionQuery.data} />
          ) : (
            <div className="empty-state">
              <strong>
                {casted ? 'The audition is over' : `No audition in progress for ${character.name}`}
              </strong>
              <span>
                {casted
                  ? `Back on ${character.name}’s page you can hear the new voice.`
                  : 'Start one: the current voice goes on the shortlist, and the voices best matching the keywords come up to hear.'}
              </span>
              <span className="chips" style={{ justifyContent: 'center' }}>
                <a className="btn" href={page}>
                  {character.name}’s page
                </a>
                {!casted && (
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={start.isPending}
                    onClick={() => start.mutate({ action: 'start' })}
                  >
                    {start.isPending ? 'Starting…' : 'Start audition'}
                  </button>
                )}
              </span>
              <Failure title="The audition could not start" result={start.data} />
              {start.isError && <span className="adopt-error">{start.error.message}</span>}
            </div>
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
  language,
}: {
  result: Extract<NonNullable<CastResult>, { ok: true }>
  summary: ProjectSummary
  name: string
  language?: string
}) {
  const titles = new Map(summary.parts.map((p) => [p.id, p.title]))
  const lines = result.stale.reduce((sum, a) => sum + a.lines, 0)
  return (
    <div className="cast-banner" role="status">
      <CheckIcon />
      <div className="cast-text">
        <strong>
          {result.changed
            ? `${result.voice.name} is now ${name}’s ${language ? `${nameOf(summary.languages, language)} ` : ''}voice`
            : `${name} keeps ${result.voice.name}`}
        </strong>
        <span>
          {result.changed
            ? language
              ? castSaved(summary.languages, language, lines)
              : `Saved to the cast for every ${summary.partLabel.toLowerCase()}. ${plural(lines, 'line')} ${lines === 1 ? 'is' : 'are'} now stale and need recording again.`
            : 'Nothing changed in the cast.'}
        </span>
        {result.stale.length > 0 && (
          <span className="chips">
            {result.stale.map((a) => (
              <a
                key={a.part}
                className="chip"
                href={routeHref({ view: 'lines', part: a.part, ...(language ? { language } : {}) })}
              >
                {shortTitle(titles.get(a.part) ?? a.part)}: {plural(a.lines, 'line')}
              </a>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}
