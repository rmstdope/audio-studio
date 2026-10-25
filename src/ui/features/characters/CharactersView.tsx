import { sharesVoiceWith, type ProjectSummary } from '../../../core/summary'
import { cardVoice, isMultilingual, languageShown, nameOf } from '../../castLanguages'
import { CharacterCard } from '../../components/CharacterCard'
import { routeHref } from '../../route'
import { LanguageSwitch } from '../lines/LanguageSwitch'
import { plural, shortTitle } from '../../format'
import { PronunciationsPanel } from './PronunciationsPanel'
import { SoundAlikePanel } from './SoundAlikePanel'

/** Every character in the project, with the parts each one speaks in. */
export function CharactersView({
  summary,
  asked,
}: {
  summary: ProjectSummary
  /** The language the address names, if any. */
  asked?: string
}) {
  const several = isMultilingual(summary.languages)
  const language = languageShown(summary.languages, asked)
  const source = summary.languages[0]!.id
  // A language besides the source: its own pronunciations and words, and cards with its voices.
  const other = several && language !== source ? nameOf(summary.languages, language) : null
  const inOther = other === null ? null : { id: language, name: other }
  const own = summary.perLanguage[language]
  const titles = new Map(summary.parts.map((p) => [p.id, shortTitle(p.title)]))
  const uncast = summary.characters.filter(
    (c) => !cardVoice(c, summary.languages, language).cast,
  ).length
  // The characters cast with a voice another one has too.
  const sharing = new Set(
    summary.characters
      .filter((c) => sharesVoiceWith(summary.characters, c.id, inOther?.id).length > 0)
      .map((c) => c.id),
  )
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Narration</span>
          <h1>All characters</h1>
          <span className="muted">
            {plural(summary.characters.length, 'character')} · {uncast} uncast
            {sharing.size > 0 && ` · ${sharing.size} sharing a voice`} · one voice per name in every{' '}
            {summary.partLabel.toLowerCase()} ·{' '}
            <span className="mono">{summary.charactersPath}</span>
          </span>
        </div>
        {several && (
          <LanguageSwitch
            tabs={summary.languages.map((l) => ({
              id: l.id,
              name: l.name,
              count: null,
              dimmed: false,
            }))}
            active={language}
            onChoose={(id) => {
              window.location.hash = routeHref({ view: 'characters', language: id })
            }}
          />
        )}
      </header>
      {own?.pronounce && (
        <PronunciationsPanel
          key={`pronounce-${language}`}
          table={own.pronounce}
          castPath={summary.charactersPath}
          language={inOther}
        />
      )}
      <SoundAlikePanel
        key={`sound-alike-${language}`}
        groups={own?.soundAlike ?? summary.soundAlike}
        projectFile={summary.projectFile}
        language={inOther}
        builtIn={language === 'en'}
      />
      {summary.characters.length ? (
        <div className="cards">
          {summary.characters.map((character) => {
            // Where she speaks in the language shown (her own lines in it).
            const spoken = (several && character.languages[language]) || character
            return (
              <CharacterCard
                key={character.id}
                character={character}
                lines={spoken.totalLines}
                otherParts={spoken.appearances.map(
                  (a) => `${titles.get(a.part) ?? a.part} · ${a.lines}`,
                )}
                sharedVoice={sharing.has(character.id)}
                languages={summary.languages}
                language={several ? language : undefined}
              />
            )
          })}
        </div>
      ) : (
        <div className="empty-state">
          <strong>No characters yet</strong>
          <span>Characters appear here once a {summary.partLabel.toLowerCase()} has dialog.</span>
        </div>
      )}
    </>
  )
}
