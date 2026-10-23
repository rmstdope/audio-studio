import type { LineStatus } from '../../../core/planner'
import type { PartSummary, ProjectSummary } from '../../../core/summary'
import type { PartDetail } from '../../../services/workspace'
import { useAdopt, usePart } from '../../api'
import { CharacterCard } from '../../components/CharacterCard'
import { AlertIcon, ListIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { StatusBar, StatusDot } from '../../components/StatusBar'
import { longTitle, plural, shortTitle } from '../../format'
import { routeHref } from '../../route'
import { REASON, STATUS, reasonCounts } from '../../status'

/** One part: how its clips stand, and a card per character speaking in it. */
export function PartOverview({ summary, part }: { summary: ProjectSummary; part: PartSummary }) {
  const hasDialog = part.dialog === 'ok'
  const detail = usePart(part.id, hasDialog)
  const loaded = detail.data?.ok ? detail.data.part : null

  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Narration / {shortTitle(part.title)}</span>
          <h1>{longTitle(part.title)}</h1>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {part.dialogPath}
          </span>
        </div>
        {hasDialog && (
          <a className="btn" href={routeHref({ view: 'lines', part: part.id })}>
            <ListIcon /> All {part.lineCount} lines
          </a>
        )}
      </header>

      {!hasDialog ? (
        <NoDialog summary={summary} part={part} />
      ) : (
        <>
          {loaded && loaded.problems.length > 0 && (
            <Problems
              title="Some of this part’s files could not be read"
              problems={loaded.problems}
            />
          )}
          {loaded ? (
            <StatusPanel part={loaded} />
          ) : (
            <section className="panel muted">
              {detail.isError
                ? `Could not load the part: ${detail.error.message}`
                : 'Checking clips…'}
            </section>
          )}
          <CastSection summary={summary} part={part} detail={loaded} />
        </>
      )}
    </>
  )
}

function StatusPanel({ part }: { part: PartDetail }) {
  const { counts } = part
  const total = part.lines.length
  const reasons = reasonCounts(part.lines)
  const shown = (Object.keys(STATUS) as LineStatus[]).filter((s) => s !== 'ok' && counts[s] > 0)

  return (
    <section className="panel status-panel" aria-label="Clip status">
      <div className="stats">
        <div className="stat stat-lead">
          <span>Lines up to date</span>
          <strong>
            {counts.ok}
            <span className="stat-of"> / {total}</span>
          </strong>
        </div>
        {shown.map((status) => (
          <div key={status} className="stat">
            <span>
              <StatusDot status={status} /> {STATUS[status].label}
            </span>
            <strong>{counts[status]}</strong>
          </div>
        ))}
        {part.orphans.length > 0 && (
          <div className="stat">
            <span>
              <span className="dot" style={{ background: 'var(--status-orphan)' }} /> Orphaned clips
            </span>
            <strong>{part.orphans.length}</strong>
          </div>
        )}
      </div>
      <StatusBar counts={counts} />
      {reasons.length > 0 && (
        <p className="status-note">
          <AlertIcon />
          Stale because: {reasons.map(([reason, n]) => `${REASON[reason]} (${n})`).join(' · ')}
        </p>
      )}
      {part.orphans.length > 0 && (
        <p className="status-note muted">
          {plural(part.orphans.length, 'clip')} in the manifest no longer{' '}
          {part.orphans.length === 1 ? 'has a line' : 'have lines'} in the dialog. Generation will
          offer to remove them.
        </p>
      )}
      {counts.untracked > 0 && <AdoptBanner part={part} />}
    </section>
  )
}

function AdoptBanner({ part }: { part: PartDetail }) {
  const adopt = useAdopt(part.id)
  const result = adopt.data
  const count = part.counts.untracked
  return (
    <div className="adopt">
      <div className="adopt-text">
        <strong>{plural(count, 'clip')} recorded before Audio Studio</strong>
        <span>
          Nothing says which voice, cue and settings {count === 1 ? 'it was' : 'they were'} made
          with. Adopt {count === 1 ? 'it' : 'them'} as made with today’s settings, so only lines
          that change from now on are re-recorded. This writes{' '}
          <span className="mono">{part.lockPath}</span>.
        </span>
        {result && !result.ok && 'problems' in result && (
          <span className="adopt-error">Fix the problems above first.</span>
        )}
        {adopt.isError && <span className="adopt-error">{adopt.error.message}</span>}
      </div>
      <button
        className="btn btn-primary"
        type="button"
        disabled={adopt.isPending}
        onClick={() => adopt.mutate()}
      >
        {adopt.isPending ? 'Adopting…' : `Adopt ${plural(count, 'clip')}`}
      </button>
    </div>
  )
}

function CastSection({
  summary,
  part,
  detail,
}: {
  summary: ProjectSummary
  part: PartSummary
  detail: PartDetail | null
}) {
  const byId = new Map(summary.characters.map((c) => [c.id, c]))
  const titles = new Map(summary.parts.map((p) => [p.id, shortTitle(p.title)]))
  const countsBySpeaker = new Map<string, Partial<Record<LineStatus, number>>>()
  for (const line of detail?.lines ?? []) {
    const counts = countsBySpeaker.get(line.speaker) ?? {}
    counts[line.status] = (counts[line.status] ?? 0) + 1
    countsBySpeaker.set(line.speaker, counts)
  }
  const characters = part.characters.flatMap(({ id, lines }) => {
    const character = byId.get(id)
    return character ? [{ character, lines }] : []
  })

  return (
    <section className="section" aria-label="Cast">
      <div className="section-head">
        <h2>Cast</h2>
        <span className="muted">
          {plural(characters.length, 'character')} in {shortTitle(part.title)} · voices shared
          across {summary.partLabel.toLowerCase()}s by name ·{' '}
          <span className="mono">{summary.charactersPath}</span>
        </span>
      </div>
      <div className="cards">
        {characters.map(({ character, lines }) => (
          <CharacterCard
            key={character.id}
            character={character}
            lines={lines}
            counts={detail ? (countsBySpeaker.get(character.id) ?? {}) : undefined}
            otherParts={character.appearances
              .filter((a) => a.part !== part.id)
              .map((a) => `Also in ${titles.get(a.part) ?? a.part}`)}
          />
        ))}
      </div>
    </section>
  )
}

function NoDialog({ summary, part }: { summary: ProjectSummary; part: PartSummary }) {
  return (
    <div className="empty-state">
      <strong>
        {part.dialog === 'missing' ? 'No dialog yet' : 'The dialog file could not be read'}
      </strong>
      <span>
        {part.dialog === 'missing' ? (
          <>
            There is no <span className="mono">{part.dialogPath}</span> yet. Extract the{' '}
            {summary.partLabel.toLowerCase()}’s dialog from the game to start.
          </>
        ) : (
          'See the problems above for what is wrong with it.'
        )}
      </span>
    </div>
  )
}
