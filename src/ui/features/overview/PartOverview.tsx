import { useState } from 'react'
import type { LineStatus } from '../../../core/planner'
import { sharesVoiceWith, type PartSummary, type ProjectSummary } from '../../../core/summary'
import type { PartDetail } from '../../../services/workspace'
import { useAdopt, useMoveCue, useMoveSceneCue, usePart, useRefreshDialog } from '../../api'
import type { RefreshResult } from '../../../services/refresh'
import { DialogGonePanel } from '../lines/DialogGonePanel'
import { PartLanguageSwitch } from '../lines/PartLanguageSwitch'
import { noDialogPanel } from '../../languages'
import { CharacterCard } from '../../components/CharacterCard'
import { AlertIcon, ListIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { StatusBar, StatusDot } from '../../components/StatusBar'
import { longTitle, plural, shortTitle } from '../../format'
import { sceneOfKey } from '../../../core/resources'
import { cueTargets, type CueTarget } from '../../cueTargets'
import { routeHref } from '../../route'
import { REASON, STATUS, reasonCounts } from '../../status'

/** One part: how its clips stand, and a card per character speaking in it. */
export function PartOverview({
  summary,
  part,
  language,
}: {
  summary: ProjectSummary
  part: PartSummary
  /** The language in the address, kept on the links to the lines page. */
  language?: string
}) {
  const several = summary.languages.length > 1
  const active = summary.languages.find((l) => l.id === language) ?? summary.languages[0]!
  const asked = several ? active.id : undefined
  const hasDialog = part.dialog === 'ok'
  const detail = usePart(part.id, hasDialog || several, asked)
  const loaded = detail.data?.ok ? detail.data.part : null
  const toRecord = loaded ? loaded.counts.missing + loaded.counts.stale : 0
  const refresh = useRefreshDialog(part.id)
  // Another language than the source may have no dialog yet, whatever the source has.
  const noLanguageDialog = several && loaded?.dialog === 'missing'
  // The dialog file is gone although recordings were made with it: they are held, not orphaned.
  const goneRecorded = several ? (loaded?.recorded ?? null) : part.recorded
  const showsLines = (several ? loaded?.dialog === 'ok' : hasDialog) && loaded !== null
  const lineCount = several ? (loaded?.lines.length ?? 0) : part.lineCount

  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Narration / {shortTitle(part.title)}</span>
          <h1>{longTitle(part.title)}</h1>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {loaded?.dialogPath ?? part.dialogPath}
          </span>
        </div>
        {several && (
          <PartLanguageSwitch
            summary={summary}
            part={part}
            active={active.id}
            progress={loaded?.languages ?? null}
            onChoose={(id) => {
              window.location.hash = routeHref({ view: 'part', part: part.id, language: id })
            }}
          />
        )}
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
            {showsLines && (
              <a className="btn" href={routeHref({ view: 'lines', part: part.id, language })}>
                <ListIcon /> All {lineCount} lines
              </a>
            )}
            {toRecord > 0 && (
              <a
                className="btn btn-primary"
                href={routeHref({ view: 'lines', part: part.id, language })}
              >
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

      {!hasDialog && !several && !goneRecorded ? (
        <NoDialog summary={summary} part={part} />
      ) : (
        <>
          {loaded && loaded.problems.length > 0 && (
            <Problems
              title="Some of this part’s files could not be read"
              problems={loaded.problems}
            />
          )}
          {loaded && loaded.orphanCues.length > 0 && <OrphanCues part={loaded} language={asked} />}
          {goneRecorded ? (
            <DialogGonePanel
              variant="overview"
              partTitle={shortTitle(part.title)}
              partLabel={summary.partLabel}
              language={several ? active.name : null}
              path={loaded?.dialogPath ?? part.dialogPath}
              recorded={goneRecorded}
              canRefresh={summary.canRefresh}
              refresh={refresh}
            />
          ) : noLanguageDialog ? (
            <NoLanguageDialog summary={summary} part={part} name={active.name} refresh={refresh} />
          ) : loaded ? (
            <StatusPanel part={loaded} language={asked} />
          ) : (
            <section className="panel muted">
              {detail.isError
                ? `Could not load the part: ${detail.error.message}`
                : 'Checking clips…'}
            </section>
          )}
          {(several || !goneRecorded) && (
            <CastSection summary={summary} part={part} detail={loaded} language={asked} />
          )}
        </>
      )}
    </>
  )
}

/** The panel for a language the part has no dialog in yet, as on the lines page. */
function NoLanguageDialog({
  summary,
  part,
  name,
  refresh,
}: {
  summary: ProjectSummary
  part: PartSummary
  name: string
  refresh: ReturnType<typeof useRefreshDialog>
}) {
  const panel = noDialogPanel(shortTitle(part.title), name, summary.canRefresh, summary.partLabel)
  return (
    <section className="panel language-empty">
      <h2>{panel.heading}</h2>
      <p className="muted">{panel.text}</p>
      {panel.refresh && (
        <button className="btn" type="button" disabled={refresh.pending} onClick={refresh.start}>
          {refresh.pending ? 'Refreshing dialog…' : 'Refresh dialog'}
        </button>
      )}
    </section>
  )
}

function StatusPanel({ part, language }: { part: PartDetail; language?: string }) {
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
      {counts.untracked > 0 && <AdoptBanner part={part} language={language} />}
    </section>
  )
}

function AdoptBanner({ part, language }: { part: PartDetail; language?: string }) {
  const adopt = useAdopt(part.id, language)
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

/** A card per character speaking in the part, with how their lines stand once that is known. */
export function CastSection({
  summary,
  part,
  detail,
  language,
}: {
  summary: ProjectSummary
  part: PartSummary
  detail: PartDetail | null
  /** The language in the address, which a card's Open keeps. */
  language?: string
}) {
  const byId = new Map(summary.characters.map((c) => [c.id, c]))
  const titles = new Map(summary.parts.map((p) => [p.id, shortTitle(p.title)]))
  // Without a dialog read in this language there are no lines to count, so none is up to date.
  const readable = detail?.dialog === 'ok'
  const countsBySpeaker = new Map<string, Partial<Record<LineStatus, number>>>()
  for (const line of detail?.lines ?? []) {
    const counts = countsBySpeaker.get(line.speaker) ?? {}
    counts[line.status] = (counts[line.status] ?? 0) + 1
    countsBySpeaker.set(line.speaker, counts)
  }
  // In a language besides the source, who speaks in the part in that language (when it has
  // dialog there), with the lines they have in it.
  const spoken =
    readable && language && language !== summary.languages[0]?.id
      ? summary.characters.flatMap((character) => {
          const lines = character.languages[language]?.appearances.find((a) => a.part === part.id)
          return lines ? [{ id: character.id, lines: lines.lines }] : []
        })
      : part.characters
  const characters = spoken.flatMap(({ id, lines }) => {
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
            counts={readable ? (countsBySpeaker.get(character.id) ?? {}) : undefined}
            otherParts={character.appearances
              .filter((a) => a.part !== part.id)
              .map((a) => `Also in ${titles.get(a.part) ?? a.part}`)}
            sharedVoice={sharesVoiceWith(summary.characters, character.id, language).length > 0}
            languages={summary.languages}
            language={language}
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
export function RefreshOutcome({
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
 * given to a line, or removed. The picker lists lines without their own cue, those without a clip
 * first (a reworded line has none yet), and suggests the one line without a clip if there is one.
 */
function OrphanCues({ part, language }: { part: PartDetail; language?: string }) {
  const targets = cueTargets(part.lines)
  return (
    <section className="panel orphan-cues" aria-label="Orphaned cues">
      <div>
        <span className="label">Orphaned cues</span>
        <strong>{plural(part.orphanCues.length, 'cue')} without a line or scene</strong>
      </div>
      <span className="muted">Cues whose line or scene is no longer in the dialog.</span>
      <ul>
        {part.orphanCues.map((orphan) => {
          const scene = sceneOfKey(orphan.key)
          return scene === null ? (
            <OrphanCue
              key={orphan.key}
              partId={part.id}
              language={language}
              orphan={orphan}
              targets={targets}
            />
          ) : (
            <OrphanSceneCue
              key={orphan.key}
              partId={part.id}
              language={language}
              scene={scene}
              cue={orphan.cue}
              targets={part.scenes.filter((s) => s.cueFrom !== 'own').map((s) => s.name)}
            />
          )
        })}
      </ul>
    </section>
  )
}

/**
 * A scene cue whose scene left the dialog, usually renamed: given to a scene that has no cue of
 * its own, or removed.
 */
function OrphanSceneCue({
  partId,
  language,
  scene,
  cue,
  targets,
}: {
  partId: string
  language?: string
  scene: string
  cue: string
  /** The scenes of the dialog that can take it: those without a cue of their own. */
  targets: string[]
}) {
  const move = useMoveSceneCue(partId, language)
  const [picked, setPicked] = useState('')
  // Only a scene still offered counts: after a reload the picked one may have its own cue now.
  const to = targets.includes(picked) ? picked : ''
  const problems = move.data && !move.data.ok && 'problems' in move.data ? move.data.problems : []
  return (
    <li>
      <div className="orphan-cue-head">
        <span className="muted">Scene</span> <strong>{scene}</strong>{' '}
        <span className="mono cue">{cue}</span>
      </div>
      <div className="orphan-cue-actions">
        <select
          aria-label={`Scene to give the cue ${cue} to`}
          value={to}
          onChange={(e) => setPicked(e.target.value)}
        >
          <option value="">Give to scene ▾</option>
          {targets.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          type="button"
          disabled={!to || move.isPending}
          onClick={() => move.mutate({ from: scene, to })}
        >
          Give
        </button>
        <button
          className="btn"
          type="button"
          disabled={move.isPending}
          onClick={() => move.mutate({ from: scene, to: null })}
        >
          Remove
        </button>
      </div>
      {problems.length > 0 && <Problems title="The cue could not be moved" problems={problems} />}
      {move.isError && <span className="adopt-error">{move.error.message}</span>}
    </li>
  )
}

function OrphanCue({
  partId,
  language,
  orphan,
  targets,
}: {
  partId: string
  language?: string
  orphan: { key: string; cue: string }
  targets: ReturnType<typeof cueTargets>
}) {
  const move = useMoveCue(partId, language)
  const [picked, setPicked] = useState<string | null>(null)
  // Only a line still offered counts: after a reload the picked one may have its own cue now.
  const offered = (key: string | null) =>
    key !== null && [...targets.fresh, ...targets.recorded].some((t) => t.key === key)
  const to = offered(picked) ? picked! : (targets.suggested ?? '')
  const problems = move.data && !move.data.ok && 'problems' in move.data ? move.data.problems : []
  const option = (target: CueTarget) => (
    <option key={target.key} value={target.key}>
      {target.label}
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
          aria-label={`Line to give the cue ${orphan.cue} to`}
          value={to}
          onChange={(e) => setPicked(e.target.value || null)}
        >
          <option value="">Give it to a line…</option>
          {targets.fresh.length > 0 && (
            <optgroup label="Lines without a clip">{targets.fresh.map(option)}</optgroup>
          )}
          {targets.recorded.length > 0 && (
            <optgroup label="Recorded lines">{targets.recorded.map(option)}</optgroup>
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
