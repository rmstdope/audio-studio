import type { LineStatus } from '../../core/planner'
import type { CharacterSummary } from '../../core/summary'
import { plural, tintFor, voiceLabel } from '../format'
import { STATUS } from '../status'
import { routeHref } from '../route'
import { HeadphonesIcon } from './icons'
import { StatusBar } from './StatusBar'

/** The badge a card shows: cast state first, then what needs doing. */
function badgeFor(
  cast: boolean,
  counts: Partial<Record<LineStatus, number>> | undefined,
): { label: string; color: string; bg: string } {
  if (!cast) return { label: 'Uncast', color: STATUS.uncast.color, bg: STATUS.uncast.bg }
  if (!counts) return { label: 'Cast', color: STATUS.ok.color, bg: STATUS.ok.bg }
  const toRecord = (counts.missing ?? 0) + (counts.stale ?? 0)
  if (toRecord) return { label: `${toRecord} to record`, ...pick('stale') }
  if (counts.untracked) return { label: `${counts.untracked} untracked`, ...pick('untracked') }
  if (counts.weak) return { label: 'Check takes', ...pick('weak') }
  return { label: 'Ready', ...pick('ok') }
}

function pick(status: LineStatus) {
  return { color: STATUS[status].color, bg: STATUS[status].bg }
}

/** What a character's lines need, in words: `2 stale · 1 missing`, or `all up to date`. */
function summaryFor(counts: Partial<Record<LineStatus, number>>): string {
  const parts = (['missing', 'stale', 'weak', 'untracked'] as const)
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${STATUS[s].label.toLowerCase()}`)
  return parts.length ? parts.join(' · ') : 'all up to date'
}

/** A character's cast entry: voice, style cue, where it speaks and, in a part, how its lines stand. */
export function CharacterCard({
  character,
  lines,
  otherParts,
  counts,
}: {
  character: CharacterSummary
  /** Lines in the part being shown, or across the project. */
  lines: number
  /** Short names of the other parts the character speaks in. */
  otherParts: string[]
  /** How many of the character's lines in the part have each status, once known. */
  counts?: Partial<Record<LineStatus, number>>
}) {
  const cast = character.voice !== null
  const badge = badgeFor(cast, counts)
  return (
    <article className="card" aria-label={character.name}>
      <div className="card-head">
        <div className="avatar" style={tintFor(character.id)} aria-hidden="true">
          {character.name.charAt(0)}
        </div>
        <div className="card-title">
          <strong>{character.name}</strong>
          <span className="mono" title={character.voice ?? undefined}>
            {voiceLabel(character)}
          </span>
        </div>
        <span className="badge" style={{ color: badge.color, background: badge.bg }}>
          {badge.label}
        </span>
      </div>
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
            <span>{summaryFor(counts)}</span>
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
          href={routeHref({ view: 'audition', character: character.id })}
        >
          <HeadphonesIcon /> Audition
        </a>
      </div>
    </article>
  )
}
