import { useState } from 'react'
import type { LineState, LineStatus } from '../../../core/planner'
import { displayName, type PartSummary, type ProjectSummary } from '../../../core/summary'
import type { PartDetail } from '../../../services/workspace'
import { useAdopt, useMoveCue, usePart, useRefreshDialog } from '../../api'
import type { RefreshResult } from '../../../services/refresh'
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
  const toRecord = loaded ? loaded.counts.missing + loaded.counts.stale : 0
  const refresh = useRefreshDialog(part.id)

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
        {(hasDialog || summary.canRefresh) && (
          <div className="header-actions">
            {summary.canRefresh && (
              <button
                className="btn"
                type="button"
                disabled={refresh.pending}
                title="Runs the project’s refreshDialog command to extract this dialog from the game"
                onClick={refresh.start}
              >
                {refresh.pending ? 'Refreshing dialog…' : 'Refresh dialog'}
              </button>
            )}
            {hasDialog && (
              <a className="btn" href={routeHref({ view: 'lines', part: part.id })}>
                <ListIcon /> All {part.lineCount} lines
              </a>
            )}
            {toRecord > 0 && (
              <a className="btn btn-primary" href={routeHref({ view: 'lines', part: part.id })}>
                Generate {plural(toRecord, 'line')}
              </a>
            )}
          </div>
        )}
      </header>
      {refresh.outcome && (
        <RefreshOutcome
          result={refresh.outcome.result}
          error={refresh.outcome.error}
          onClose={refresh.dismiss}
        />
      )}

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
          {loaded && loaded.orphanCues.length > 0 && <OrphanCues part={loaded} />}
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
            {summary.partLabel.toLowerCase()}’s dialog from the game to start
            {summary.canRefresh ? ': Refresh dialog does it.' : '.'}
          </>
        ) : (
          'See the problems above for what is wrong with it.'
        )}
      </span>
    </div>
  )
}

/** What the last Refresh dialog did: the lines added, removed and changed, or why it failed. */
function RefreshOutcome({
  result,
  error,
  onClose,
}: {
  result: NonNullable<RefreshResult> | null
  error: string | null
  onClose: () => void
}) {
  const close = (
    <button className="btn" type="button" onClick={onClose}>
      Close
    </button>
  )
  if (result?.ok) {
    const diff = result.diff
    const parts = diff
      ? [
          diff.added.length && `${diff.added.length} added`,
          diff.removed.length && `${diff.removed.length} removed`,
          diff.changed.length && `${diff.changed.length} changed`,
        ].filter(Boolean)
      : ['the dialog could not be read before, so what changed is not known']
    return (
      <section className="panel refresh-outcome" aria-label="Refresh dialog">
        <div className="refresh-head">
          <div>
            <span className="label">Dialog refreshed</span>
            <strong>
              {plural(result.lines, 'line')} · {parts.length ? parts.join(' · ') : 'no changes'}
            </strong>
          </div>
          {close}
        </div>
        {diff && diff.removed.length > 0 && (
          <span className="muted">
            A reworded line gets a new key, so it shows as one removed and one added. Any clip or
            cue the old line had is orphaned now.
          </span>
        )}
      </section>
    )
  }
  const message =
    error ?? (result && 'message' in result ? result.message : 'The dialog could not be refreshed.')
  return (
    <section className="panel refresh-outcome" aria-label="Refresh dialog">
      <div className="refresh-head">
        <div>
          <span className="label">Refresh dialog failed</span>
          <strong>{message}</strong>
        </div>
        {close}
      </div>
      {result && 'problems' in result && (
        <Problems title="The new dialog cannot be used" problems={result.problems} />
      )}
      {result && 'output' in result && result.output && (
        <pre className="refresh-output mono">{result.output}</pre>
      )}
    </section>
  )
}

/**
 * Cues whose line left the dialog, usually because it was reworded and got a new key: each can be
 * given to its line's new key, or removed. Lines without a clip come first, since a reworded line
 * has none yet.
 */
function OrphanCues({ part }: { part: PartDetail }) {
  const free = part.lines.filter((line) => !line.ownCue)
  const fresh = free.filter((line) => line.file === null)
  const recorded = free.filter((line) => line.file !== null)
  return (
    <section className="panel orphan-cues" aria-label="Orphaned cues">
      <div>
        <span className="label">Orphaned cues</span>
        <strong>{plural(part.orphanCues.length, 'cue')} without a line</strong>
      </div>
      <span className="muted">
        Their lines left the dialog, usually reworded under a new key. Give each cue to its line’s
        new key, or remove it.
      </span>
      <ul>
        {part.orphanCues.map((orphan) => (
          <OrphanCue
            key={orphan.key}
            partId={part.id}
            orphan={orphan}
            fresh={fresh}
            recorded={recorded}
          />
        ))}
      </ul>
    </section>
  )
}

function OrphanCue({
  partId,
  orphan,
  fresh,
  recorded,
}: {
  partId: string
  orphan: { key: string; cue: string }
  fresh: LineState[]
  recorded: LineState[]
}) {
  const move = useMoveCue(partId)
  const [to, setTo] = useState('')
  const problems = move.data && !move.data.ok && 'problems' in move.data ? move.data.problems : []
  const option = (line: LineState) => (
    <option key={line.key} value={line.key}>
      {displayName(line.speaker)}:{' '}
      {line.text.length > 70 ? `${line.text.slice(0, 70)}…` : line.text}
    </option>
  )
  return (
    <li>
      <div className="orphan-cue-head">
        <span className="mono cue">{orphan.cue}</span>
        <span className="mono muted">{orphan.key}</span>
      </div>
      <div className="orphan-cue-actions">
        <select
          aria-label={`Line to give ${orphan.cue} to`}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        >
          <option value="">Give it to a line…</option>
          {fresh.length > 0 && (
            <optgroup label="Lines without a clip">{fresh.map(option)}</optgroup>
          )}
          {recorded.length > 0 && (
            <optgroup label="Recorded lines">{recorded.map(option)}</optgroup>
          )}
        </select>
        <button
          className="btn"
          type="button"
          disabled={!to || move.isPending}
          onClick={() => move.mutate({ key: orphan.key, to })}
        >
          Move
        </button>
        <button
          className="btn"
          type="button"
          disabled={move.isPending}
          onClick={() => move.mutate({ key: orphan.key, to: null })}
        >
          Remove
        </button>
      </div>
      {problems.length > 0 && <Problems title="The cue could not be moved" problems={problems} />}
      {move.isError && <span className="adopt-error">{move.error.message}</span>}
    </li>
  )
}
