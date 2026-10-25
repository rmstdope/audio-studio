import type { LineStatus } from '../../core/planner'
import type { CharacterSummary } from '../../core/summary'
import { plural, tintFor } from '../format'
import { linesSummary, STATUS } from '../status'
import { routeHref } from '../route'
import { StatusBar } from './StatusBar'
import { cardVoice, missingVoiceChips, type Language } from '../castLanguages'

/** The badge a card shows: cast state first, then what needs doing; Ready only when nothing does. */
export function badgeFor(
  cast: boolean,
  counts: Partial<Record<LineStatus, number>> | undefined,
): { label: string; color: string; bg: string } {
  if (!cast) return { label: 'Uncast', color: STATUS.uncast.color, bg: STATUS.uncast.bg }
  if (!counts) return { label: 'Cast', color: STATUS.ok.color, bg: STATUS.ok.bg }
  const toRecord = (counts.missing ?? 0) + (counts.stale ?? 0)
  if (toRecord) return { label: `${toRecord} to record`, ...pick('stale') }
  if (counts.untracked) return { label: `${counts.untracked} untracked`, ...pick('untracked') }
  if (counts.weak) return { label: 'Check takes', ...pick('weak') }
  if (counts.uncast) return { label: STATUS.uncast.label, ...pick('uncast') }
  if (counts.untranslated) return { label: STATUS.untranslated.label, ...pick('untranslated') }
  return { label: 'Ready', ...pick('ok') }
}

function pick(status: LineStatus) {
  return { color: STATUS[status].color, bg: STATUS[status].bg }
}

/** A character's cast entry: voice, style cue, where it speaks and, in a part, how its lines stand. */
export function CharacterCard({
  character,
  lines,
  otherParts,
  counts,
  sharedVoice = false,
  languages = [],
  language,
}: {
  character: CharacterSummary
  /** Lines in the part being shown, or across the project. */
  lines: number
  /** Short names of the other parts the character speaks in. */
  otherParts: string[]
  /** How many of the character's lines in the part have each status, once known. */
  counts?: Partial<Record<LineStatus, number>>
  /** Another character is cast with the same voice. */
  sharedVoice?: boolean
  /** The declared languages: a card adds a chip for each but the first with no voice for her. */
  languages?: Language[]
  /** The language the page the card is on shows, which Open keeps. */
  language?: string
}) {
  const voice = cardVoice(character, languages, language)
  const cast = voice.cast
  const badge = badgeFor(cast, counts)
  return (
    <article className="card" aria-label={character.name}>
      <div className="card-head">
        <div className="avatar" style={tintFor(character.id)} aria-hidden="true">
          {character.name.charAt(0)}
        </div>
        <div className="card-title">
          <strong>{character.name}</strong>
          <span
            className="mono"
            title={(language ? character.languages[language]?.voice : character.voice) ?? undefined}
          >
            {voice.label}
          </span>
        </div>
        <span className="badge" style={{ color: badge.color, background: badge.bg }}>
          {badge.label}
        </span>
      </div>
      {sharedVoice && (
        <span className="chip chip-warn" title="Another character has this voice">
          Shared voice
        </span>
      )}
      {missingVoiceChips(character, languages).map((chip) => (
        <span key={chip} className="chip chip-warn">
          {chip}
        </span>
      ))}
      {character.style ? (
        <span className="style-cue" title={character.style}>
          {character.style}
        </span>
      ) : (
        <span className="style-cue empty">No style cue</span>
      )}
      {counts && cast && (
        <div className="card-status">
          <div className="card-status-text">
            <span>{plural(lines, 'line')}</span>
            <span>{linesSummary(counts)}</span>
          </div>
          <StatusBar counts={counts} height={5} />
        </div>
      )}
      <div className="card-foot">
        {!(counts && cast) && <span className="lines">{plural(lines, 'line')}</span>}
        {otherParts.map((part) => (
          <span key={part} className="chip">
            {part}
          </span>
        ))}
        <a
          className="btn card-action"
          href={routeHref({
            view: 'character',
            character: character.id,
            ...(language ? { language } : {}),
          })}
        >
          Open
        </a>
      </div>
    </article>
  )
}
