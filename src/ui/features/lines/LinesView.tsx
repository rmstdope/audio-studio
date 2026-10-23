import { useEffect, useMemo, useRef, useState } from 'react'
import type { LineState, LineStatus } from '../../../core/planner'
import type { PartSummary } from '../../../core/summary'
import { clipUrl, usePart, useRecordLines, useSetCue } from '../../api'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { StatusDot, StatusPill } from '../../components/StatusBar'
import { GeneratePanel } from './GeneratePanel'
import { useClipPlayer } from '../../components/useClipPlayer'
import { displayName } from '../../../core/summary'
import { longTitle, plural, shortTitle } from '../../format'
import { routeHref } from '../../route'
import { STATUS, percent, seconds, statusDetail } from '../../status'

type Filter = 'all' | 'attention' | LineStatus | 'orphans'

/**
 * Lines a Record button is offered for: no clip, a clip made from other inputs, or a weak one
 * (Retake).
 */
const RECORDABLE = new Set<LineStatus>(['missing', 'stale', 'weak'])

/** Lines that need something done: everything but up to date. */
const needsAttention = (line: LineState) => line.status !== 'ok'

/** Every line of a part with the state of its clip, filtered by status, speaker and words. */
export function LinesView({ part }: { part: PartSummary }) {
  const detail = usePart(part.id, part.dialog === 'ok')
  const { playing, toggle } = useClipPlayer()
  const recorder = useRecordLines(part.id)
  const [filter, setFilter] = useState<Filter>('attention')
  const [speaker, setSpeaker] = useState('')
  const [search, setSearch] = useState('')

  const loaded = detail.data?.ok ? detail.data.part : null
  const lines = useMemo(() => {
    const words = search.trim().toLowerCase()
    return (loaded?.lines ?? []).filter(
      (line) =>
        (filter === 'all' ||
          (filter === 'attention' ? needsAttention(line) : line.status === filter)) &&
        (!speaker || line.speaker === speaker) &&
        (!words || line.text.toLowerCase().includes(words) || line.key.includes(words)),
    )
  }, [loaded, filter, speaker, search])

  const header = (
    <header className="page-header">
      <div>
        <span className="crumbs">
          <a href={routeHref({ view: 'part', part: part.id })}>
            Narration / {shortTitle(part.title)}
          </a>
        </span>
        <h1>Lines</h1>
        <span className="muted">
          {longTitle(part.title)} · {plural(part.lineCount, 'line')}
        </span>
      </div>
    </header>
  )

  if (!loaded) {
    return (
      <>
        {header}
        <section className="panel muted">
          {part.dialog === 'invalid'
            ? 'The dialog file could not be read: see the part’s overview for what is wrong.'
            : part.dialog !== 'ok'
              ? 'This part has no dialog yet.'
              : detail.isError
                ? `Could not load the part: ${detail.error.message}`
                : 'Checking clips…'}
        </section>
      </>
    )
  }

  const attention = loaded.lines.filter(needsAttention).length
  const tabs: { id: Filter; label: string; count: number; status?: LineStatus }[] = [
    { id: 'attention', label: 'Needs attention', count: attention },
    ...(Object.keys(STATUS) as LineStatus[])
      .filter((s) => loaded.counts[s] > 0)
      .map((s) => ({ id: s, label: STATUS[s].label, count: loaded.counts[s], status: s })),
    ...(loaded.orphans.length
      ? [{ id: 'orphans' as const, label: 'Orphaned', count: loaded.orphans.length }]
      : []),
    { id: 'all', label: 'All', count: loaded.lines.length },
  ]
  const speakers = [...new Set(loaded.lines.map((l) => l.speaker))].sort()

  return (
    <>
      {header}
      {loaded.problems.length > 0 && (
        <Problems title="Some of this part’s files could not be read" problems={loaded.problems} />
      )}

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter by status">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={filter === tab.id}
              onClick={() => setFilter(tab.id)}
            >
              {tab.status && <StatusDot status={tab.status} />}
              {tab.label}
              <span className="mono tab-count">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="filters">
          <label className="field">
            <span>Character</span>
            <select value={speaker} onChange={(e) => setSpeaker(e.target.value)}>
              <option value="">All</option>
              {speakers.map((s) => (
                <option key={s} value={s}>
                  {displayName(s)}
                </option>
              ))}
            </select>
          </label>
          <input
            className="search"
            type="search"
            placeholder="Search lines"
            aria-label="Search lines"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <GeneratePanel partId={loaded.id} speaker={speaker || null} />

      {filter === 'orphans' ? (
        <OrphanTable part={loaded.id} orphans={loaded.orphans} playing={playing} toggle={toggle} />
      ) : (
        <div className="table-box">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Status</th>
                <th>Line</th>
                <th style={{ width: 220 }}>Delivery</th>
                <th style={{ width: 70 }}>Length</th>
                <th style={{ width: 70 }}>Heard</th>
                <th style={{ width: 140 }}>
                  <span className="sr-only">Play and record</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key}>
                  <td>
                    <StatusPill status={line.status} />
                  </td>
                  <td>
                    <div className="line-cell">
                      <span className="line-speaker">
                        {displayName(line.speaker)} <span className="mono muted">{line.key}</span>
                      </span>
                      <span className="line-text">{line.text}</span>
                      {line.status !== 'ok' && (
                        <span className="line-detail" style={{ color: STATUS[line.status].color }}>
                          {statusDetail(line, loaded.minHeard)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <CueCell partId={loaded.id} line={line} />
                  </td>
                  <td className="mono num">{seconds(line.duration)}</td>
                  <td className="mono num">{percent(line.heard)}</td>
                  <td>
                    <div className="row-actions">
                      {line.file && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={playing === line.key ? 'Stop' : `Play ${line.key}`}
                          onClick={() => toggle(line.key, clipUrl(loaded.id, line.file!))}
                        >
                          {playing === line.key ? <PauseIcon /> : <PlayIcon />}
                        </button>
                      )}
                      {RECORDABLE.has(line.status) && (
                        <button
                          type="button"
                          className="btn row-record"
                          disabled={recorder.recording.has(line.key)}
                          onClick={() => void recorder.record(line.key)}
                        >
                          {recorder.recording.has(line.key)
                            ? 'Recording…'
                            : line.status === 'weak'
                              ? 'Retake'
                              : 'Record'}
                        </button>
                      )}
                    </div>
                    {recorder.errors[line.key] && (
                      <span className="adopt-error row-error">{recorder.errors[line.key]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lines.length === 0 && <p className="table-empty muted">No lines match.</p>}
        </div>
      )}
      <span className="muted" style={{ fontSize: 12 }}>
        Showing {plural(filter === 'orphans' ? loaded.orphans.length : lines.length, 'line')}
      </span>
    </>
  )
}

function OrphanTable({
  part,
  orphans,
  playing,
  toggle,
}: {
  part: string
  orphans: { key: string; speaker: string | null; file: string }[]
  playing: string | null
  toggle: (id: string, url: string) => void
}) {
  return (
    <div className="table-box">
      <table className="table">
        <thead>
          <tr>
            <th>Clip</th>
            <th style={{ width: 160 }}>Speaker</th>
            <th style={{ width: 56 }}>
              <span className="sr-only">Play</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orphans.map((orphan) => (
            <tr key={orphan.key}>
              <td>
                <div className="line-cell">
                  <span className="mono">{orphan.file}</span>
                  <span className="line-detail muted">
                    Its line is no longer in the dialog: the wording changed or the line was
                    removed.
                  </span>
                </div>
              </td>
              <td>{orphan.speaker ? displayName(orphan.speaker) : '—'}</td>
              <td>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={playing === orphan.key ? 'Stop' : `Play ${orphan.file}`}
                  onClick={() => toggle(orphan.key, clipUrl(part, orphan.file))}
                >
                  {playing === orphan.key ? <PauseIcon /> : <PlayIcon />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A line's cue: its own, or its character's style (dimmed). Clicking it edits the line's own cue;
 * saving an empty one goes back to the style.
 */
function CueCell({ partId, line }: { partId: string; line: LineState }) {
  const save = useSetCue(partId)
  const [draft, setDraft] = useState<string | null>(null)
  const cell = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const problems = save.data && !save.data.ok && 'problems' in save.data ? save.data.problems : []
  const own = line.ownCue ? line.cue : ''

  // Back on the cue after editing, so the keyboard keeps its place in the table.
  useEffect(() => {
    if (draft === null && refocus.current) {
      refocus.current = false
      cell.current?.focus()
    }
  }, [draft])

  const close = () => {
    refocus.current = true
    setDraft(null)
  }
  const done = (result: { ok: boolean }) => result.ok && close()

  if (draft === null) {
    return (
      <button
        ref={cell}
        type="button"
        className={`cue-button mono${line.ownCue ? '' : ' from-style'}`}
        title={
          line.ownCue
            ? 'This line’s own cue: edit'
            : 'The character’s style: give this line its own cue'
        }
        onClick={() => {
          save.reset()
          setDraft(own)
        }}
      >
        {line.cue || '—'}
      </button>
    )
  }
  return (
    <form
      className="cue-edit"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate({ key: line.key, cue: draft }, { onSuccess: done })
      }}
    >
      <input
        className="mono"
        autoFocus
        aria-label={`Cue for ${line.key}`}
        placeholder={line.ownCue ? '' : line.cue || '[a cue for this line]'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      />
      <div className="cue-actions">
        <button className="btn" type="submit" disabled={save.isPending || draft.trim() === own}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {line.ownCue && (
          <button
            className="btn"
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ key: line.key, cue: '' }, { onSuccess: done })}
          >
            Use style
          </button>
        )}
        <button className="btn" type="button" onClick={close}>
          Cancel
        </button>
      </div>
      {problems.length > 0 && <Problems title="The cue could not be saved" problems={problems} />}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}
