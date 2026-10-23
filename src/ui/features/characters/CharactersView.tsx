import type { ProjectSummary } from '../../../core/summary'
import { CharacterCard } from '../../components/CharacterCard'
import { plural, shortTitle } from '../../format'

/** Every character in the project, with the parts each one speaks in. */
export function CharactersView({ summary }: { summary: ProjectSummary }) {
  const titles = new Map(summary.parts.map((p) => [p.id, shortTitle(p.title)]))
  const uncast = summary.characters.filter((c) => c.voice === null).length
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Narration</span>
          <h1>All characters</h1>
          <span className="muted">
            {plural(summary.characters.length, 'character')} · {uncast} uncast · one voice per name
            in every {summary.partLabel.toLowerCase()} ·{' '}
            <span className="mono">{summary.charactersPath}</span>
          </span>
        </div>
      </header>
      {summary.characters.length ? (
        <div className="cards">
          {summary.characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              lines={character.totalLines}
              otherParts={character.appearances.map(
                (a) => `${titles.get(a.part) ?? a.part} · ${a.lines}`,
              )}
            />
          ))}
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
