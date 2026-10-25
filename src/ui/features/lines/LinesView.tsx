import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { LineState, LineStatus } from '../../../core/planner'
import type { LanguageProgress } from '../../../services/workspace'
import type { PartSummary, ProjectSummary } from '../../../core/summary'
import {
  clipUrl,
  takeUrl,
  useAccept,
  useCheckAgain,
  usePart,
  useRefreshDialog,
  useRecordLines,
  useSetCue,
  useSetNote,
  useTryCue,
} from '../../api'
import { ListIcon, PauseIcon, PlayIcon } from '../../components/icons'
import { Problems } from '../../components/Problems'
import { StatusDot, StatusPill } from '../../components/StatusBar'
import { RefreshOutcome } from '../overview/PartOverview'
import { GeneratePanel } from './GeneratePanel'
import { LanguageSwitch } from './LanguageSwitch'
import { HeardComparison } from './HeardComparison'
import { LineTakes } from './LineTakes'
import { canCompare } from '../../heard'
import { useClipPlayer } from '../../components/useClipPlayer'
import { displayName } from '../../../core/summary'
import { dollars, longTitle, plural, shortTitle } from '../../format'
import { cueButtonTitle, cueHint, cueNote, languageTab, noDialogPanel } from '../../languages'
import { routeHref } from '../../route'
import { STATUS, percent, seconds, statusDetail } from '../../status'
import { clipsInTurn, playthroughButton } from '../../playthrough'
import { LINE_KEYS, isTyping, lineKeyAction } from '../../lineKeys'

type Filter = 'all' | 'attention' | LineStatus | 'orphans' | 'notes'

/**
 * Lines a Record button is offered for: no clip, a clip made from other inputs, or a weak one
 * (Retake).
 */
const RECORDABLE = new Set<LineStatus>(['missing', 'stale', 'weak'])

/** Lines that need something done: everything but up to date. */
const needsAttention = (line: LineState) => line.status !== 'ok'

/** Every line of a part with the state of its clip, filtered by status, speaker and words. */
export function LinesView({
  summary,
  part,
  language,
}: {
  summary: ProjectSummary
  part: PartSummary
  /** The language asked for in the address; the source language if it is not declared. */
  language?: string
}) {
  const declared = summary.languages
  const several = declared.length > 1
  const active = declared.find((l) => l.id === language) ?? declared[0]!
  // Another language than the first: its lines are listed with the first's text beneath, and none is recorded yet.
  const foreign = active.id !== declared[0]!.id
  // What the hooks and links ask with: the language, in a project with several.
  const asked = several ? active.id : undefined
  const source = declared[0]!
  const detail = usePart(part.id, several || part.dialog === 'ok', several ? active.id : undefined)
  const refresh = useRefreshDialog(part.id)
  const clip = (file: string) => clipUrl(part.id, file, several ? active.id : undefined)
  // The last counts seen, so the switch keeps them while another language loads.
  const seen = useRef<LanguageProgress[] | null>(null)
  const { playing, inTurn, toggle, playInTurn, stop } = useClipPlayer()
  const recorder = useRecordLines(part.id, asked)
  const accept = useAccept(part.id, asked)
  const check = useCheckAgain(part.id, asked)
  // The lines Whisper is checking again, and why a line's last Accept or Check again failed.
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set())
  const [refused, setRefused] = useState<Record<string, string>>({})
  const onRow = async (
    key: string,
    action: (key: string) => Promise<{ ok: boolean } | null>,
    what: string,
  ) => {
    setRefused(({ [key]: _, ...rest }) => rest)
    let why: string | null = null
    try {
      const result = await action(key)
      if (result && !result.ok) {
        why = 'message' in result ? String(result.message) : `The line could not be ${what}.`
      }
    } catch (error) {
      why = error instanceof Error ? error.message : String(error)
    }
    if (why) setRefused((all) => ({ ...all, [key]: why }))
  }
  const checkAgain = async (key: string) => {
    setChecking((all) => new Set(all).add(key))
    await onRow(key, check.mutateAsync, 'checked again')
    setChecking((all) => {
      const left = new Set(all)
      left.delete(key)
      return left
    })
  }
  const [filter, setFilter] = useState<Filter>('attention')
  const [speaker, setSpeaker] = useState('')
  // Another language has other statuses and speakers: start from what needs attention again,
  // however the language changed (the switch, Back, an address).
  useEffect(() => {
    setFilter('attention')
    setSpeaker('')
  }, [active.id])
  const [search, setSearch] = useState('')
  // The line whose take is compared with what Whisper heard, if any.
  const [comparing, setComparing] = useState<string | null>(null)
  // The line whose extra takes are open, if any.
  const [takesOf, setTakesOf] = useState<string | null>(null)

  const loaded = detail.data?.ok ? detail.data.part : null
  if (loaded) seen.current = loaded.languages
  const lines = useMemo(() => {
    const words = search.trim().toLowerCase()
    return (loaded?.lines ?? []).filter(
      (line) =>
        (filter === 'all' ||
          (filter === 'attention'
            ? needsAttention(line)
            : filter === 'notes'
              ? Object.hasOwn(loaded?.notes ?? {}, line.key)
              : line.status === filter)) &&
        (!speaker || line.speaker === speaker) &&
        (!words || line.text.toLowerCase().includes(words) || line.key.includes(words)),
    )
  }, [loaded, filter, speaker, search])

  // A playthrough: the lines shown with a clip, in turn, from the first or from one line.
  const turn = clipsInTurn(lines)
  const playFrom = (key?: string) =>
    playInTurn(
      (key === undefined ? turn : clipsInTurn(lines, key)).map((c) => ({
        id: c.key,
        url: clip(c.file),
      })),
    )
  const playButton = playthroughButton(inTurn, turn.length, lines.length)
  const playingRow = useRef<HTMLTableRowElement>(null)

  /**
   * Keys on a focused row: move, play, and the row's own buttons (found in the row, so each
   * component keeps its own behaviour). A key pressed while typing in a field is left to it.
   */
  const onRowKey = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLTableRowElement>('tr[data-key]')
    if (!row) return
    const action = lineKeyAction({
      key: event.key,
      modifier: event.metaKey || event.ctrlKey || event.altKey,
      typing: isTyping(target.tagName),
      onButton: target !== row,
    })
    if (!action) return
    const key = row.dataset.key!
    const line = lines.find((l) => l.key === key)
    const click = (selector: string) => row.querySelector<HTMLButtonElement>(selector)?.click()
    switch (action) {
      case 'next':
      case 'previous': {
        const rows = [...row.parentElement!.querySelectorAll<HTMLTableRowElement>('tr[data-key]')]
        const at = rows.indexOf(row) + (action === 'next' ? 1 : -1)
        rows[at]?.focus()
        break
      }
      case 'play':
        if (line?.file) toggle(line.key, clip(line.file))
        break
      case 'fromHere':
        if (line?.file) playFrom(line.key)
        break
      case 'record':
        click('.row-record')
        break
      case 'accept':
        click('.row-accept')
        break
      case 'heard':
        click('.heard-btn')
        break
      case 'cue':
        click('.cue-button')
        break
      case 'note':
        click('.note-button, .note-add')
        break
      case 'takes':
        click('.row-takes')
        break
    }
    event.preventDefault()
  }
  useEffect(() => {
    if (inTurn) playingRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [playing, inTurn])

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
      {several && (
        <LanguageSwitch
          tabs={declared.map((language) => {
            const known = seen.current?.find((p) => p.id === language.id)
            const tab = known ? languageTab(known, shortTitle(part.title)) : null
            return {
              id: language.id,
              name: language.name,
              count: tab?.count ?? null,
              title: tab?.title,
              dimmed: tab?.dimmed ?? false,
            }
          })}
          active={active.id}
          onChoose={(id) => {
            window.location.hash = routeHref({ view: 'lines', part: part.id, language: id })
          }}
        />
      )}
    </header>
  )

  const dialog = loaded ? loaded.dialog : several ? 'ok' : part.dialog
  if (loaded && dialog === 'missing' && several) {
    const panel = noDialogPanel(
      shortTitle(part.title),
      active.name,
      summary.canRefresh,
      summary.partLabel,
    )
    return (
      <>
        {header}
        <section className="panel language-empty">
          <h2>{panel.heading}</h2>
          <p className="muted">{panel.text}</p>
          {panel.refresh && (
            <button
              className="btn"
              type="button"
              disabled={refresh.pending}
              onClick={refresh.start}
            >
              {refresh.pending ? 'Refreshing dialog…' : 'Refresh dialog'}
            </button>
          )}
        </section>
        {refresh.outcome && (
          <RefreshOutcome
            result={refresh.outcome.result}
            error={refresh.outcome.error}
            onClose={refresh.dismiss}
          />
        )}
      </>
    )
  }
  if (!loaded || dialog !== 'ok') {
    return (
      <>
        {header}
        <section className="panel muted">
          {dialog === 'invalid'
            ? 'The dialog file could not be read: see the part’s overview for what is wrong.'
            : dialog !== 'ok'
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
    ...(Object.keys(loaded.notes).length
      ? [{ id: 'notes' as const, label: 'With a note', count: Object.keys(loaded.notes).length }]
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
          {playButton && (
            <button
              className="btn"
              type="button"
              title={
                playButton.stop
                  ? undefined
                  : 'Hear the lines shown one after another, as the game plays them'
              }
              onClick={() => (playButton.stop ? stop() : playFrom())}
            >
              {playButton.stop ? <PauseIcon /> : <PlayIcon />} {playButton.label}
            </button>
          )}
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

      <GeneratePanel
        partId={loaded.id}
        language={several ? active : null}
        speaker={speaker || null}
        models={{ draft: loaded.draftModel, final: loaded.finalModel }}
      />

      {filter === 'orphans' ? (
        <OrphanTable
          part={loaded.id}
          language={several ? active.id : undefined}
          orphans={loaded.orphans}
          playing={playing}
          toggle={toggle}
        />
      ) : (
        <div className="table-box">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Status</th>
                <th>Line</th>
                <th style={{ width: 220 }}>Delivery{foreign ? ` (${active.name})` : ''}</th>
                <th style={{ width: 70 }}>Length</th>
                <th style={{ width: 70 }}>Heard</th>
                <th style={{ width: 140 }}>
                  <span className="sr-only">Play and record</span>
                </th>
              </tr>
            </thead>
            <tbody onKeyDown={onRowKey}>
              {lines.map((line) => (
                <Fragment key={line.key}>
                  <tr
                    ref={playing === line.key ? playingRow : undefined}
                    className={playing === line.key ? 'playing' : undefined}
                    data-key={line.key}
                    tabIndex={0}
                    aria-label={`${displayName(line.speaker)}: ${line.text || line.english || line.key}`}
                  >
                    <td>
                      <StatusPill status={line.status} />
                      {line.final && (
                        <span className="final-badge" title="Made with the final model">
                          final
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="line-cell">
                        <span className="line-speaker">
                          {displayName(line.speaker)} <span className="mono muted">{line.key}</span>
                        </span>
                        {line.status === 'untranslated' ? (
                          <span className="line-gap">No {active.name} text for this line yet.</span>
                        ) : (
                          <span className="line-text">{line.text}</span>
                        )}
                        {foreign &&
                          (line.english !== null ? (
                            <span className="line-english">
                              <b>{source.name}</b>
                              {line.english}
                            </span>
                          ) : (
                            <span className="line-gap line-english">No {source.name} line.</span>
                          ))}
                        {line.status !== 'ok' &&
                          statusDetail(line, loaded.minHeard, asked && active.name) && (
                            <span
                              className="line-detail"
                              style={{ color: STATUS[line.status].color }}
                            >
                              {statusDetail(line, loaded.minHeard, asked && active.name)}
                            </span>
                          )}
                        <NoteCell
                          partId={loaded.id}
                          lineKey={line.key}
                          language={asked}
                          note={
                            Object.hasOwn(loaded.notes, line.key) ? loaded.notes[line.key]! : ''
                          }
                        />
                      </div>
                    </td>
                    <td>
                      <CueCell
                        partId={loaded.id}
                        line={line}
                        language={asked}
                        names={foreign ? { language: active.name, source: source.name } : null}
                        playing={playing}
                        toggle={toggle}
                      />
                    </td>
                    <td className="mono num">{seconds(line.duration)}</td>
                    <td className="mono num">
                      {canCompare(line.heard) ? (
                        <button
                          type="button"
                          className="heard-btn"
                          aria-expanded={comparing === line.key}
                          title="Compare what Whisper heard with the text"
                          onClick={() => setComparing(comparing === line.key ? null : line.key)}
                        >
                          {percent(line.heard)}
                        </button>
                      ) : (
                        percent(line.heard)
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        {RECORDABLE.has(line.status) || line.status === 'ok' ? (
                          <button
                            type="button"
                            className="btn row-takes"
                            aria-expanded={takesOf === line.key}
                            title="Extra takes of this line: hear, compare, use one as the clip"
                            onClick={() => setTakesOf(takesOf === line.key ? null : line.key)}
                          >
                            Takes
                          </button>
                        ) : null}
                        {line.file && (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={playing === line.key ? 'Stop' : `Play ${line.key}`}
                            onClick={() => toggle(line.key, clip(line.file!))}
                          >
                            {playing === line.key ? <PauseIcon /> : <PlayIcon />}
                          </button>
                        )}
                        {line.file && (
                          <button
                            type="button"
                            className="icon-btn from-here"
                            aria-label={`Play from ${line.key} onward`}
                            title="Play from here onward, as the game plays them"
                            onClick={() => playFrom(line.key)}
                          >
                            <ListIcon />
                          </button>
                        )}
                        {RECORDABLE.has(line.status) &&
                          (recorder.toConfirm[line.key] !== undefined ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-primary row-record"
                                title="The most this line can cost on your Fish account (every take)"
                                onClick={() =>
                                  void recorder.record(
                                    line.key,
                                    recorder.toConfirm[line.key],
                                    line.final ? 'final' : 'draft',
                                  )
                                }
                              >
                                Pay up to {dollars(recorder.toConfirm[line.key]!)}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => recorder.cancel(line.key)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn row-record"
                              disabled={recorder.recording.has(line.key)}
                              // A final clip is recorded again with the final model, never downgraded.
                              onClick={() =>
                                void recorder.record(
                                  line.key,
                                  undefined,
                                  line.final ? 'final' : 'draft',
                                )
                              }
                            >
                              {recorder.recording.has(line.key)
                                ? 'Recording…'
                                : line.status === 'weak'
                                  ? 'Retake'
                                  : 'Record'}
                            </button>
                          ))}
                        {line.status === 'weak' &&
                          recorder.toConfirm[line.key] === undefined &&
                          !recorder.recording.has(line.key) && (
                            <>
                              <button
                                type="button"
                                className="btn row-accept"
                                title="Keep this take as it is: the line no longer shows as weak, until it is recorded again"
                                disabled={checking.has(line.key)}
                                onClick={() => void onRow(line.key, accept.mutateAsync, 'accepted')}
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                className="btn"
                                title="Have Whisper hear this take again with today's rules, without recording anything"
                                disabled={checking.has(line.key)}
                                onClick={() => void checkAgain(line.key)}
                              >
                                {checking.has(line.key) ? 'Checking…' : 'Check again'}
                              </button>
                            </>
                          )}
                      </div>
                      {recorder.errors[line.key] && (
                        <span className="adopt-error row-error">{recorder.errors[line.key]}</span>
                      )}
                      {refused[line.key] && (
                        <span className="adopt-error row-error">{refused[line.key]}</span>
                      )}
                    </td>
                  </tr>
                  {comparing === line.key && canCompare(line.heard) && (
                    <tr className="heard-row">
                      <td />
                      <td colSpan={5}>
                        <HeardComparison partId={loaded.id} lineKey={line.key} language={asked} />
                      </td>
                    </tr>
                  )}
                  {takesOf === line.key && (
                    <tr className="heard-row takes-row">
                      <td />
                      <td colSpan={5}>
                        <LineTakes
                          partId={loaded.id}
                          lineKey={line.key}
                          language={asked}
                          draftModel={loaded.draftModel}
                          playing={playing}
                          toggle={toggle}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {lines.length === 0 && <p className="table-empty muted">No lines match.</p>}
        </div>
      )}
      {filter !== 'orphans' && lines.length > 0 && (
        <p className="keys-hint muted">
          On a row:{' '}
          {LINE_KEYS.map((k, i) => (
            <span key={k.action}>
              {i > 0 && ' · '}
              <kbd>{k.shown}</kbd> {k.does}
            </span>
          ))}
        </p>
      )}
      <span className="muted" style={{ fontSize: 12 }}>
        Showing {plural(filter === 'orphans' ? loaded.orphans.length : lines.length, 'line')}
      </span>
    </>
  )
}

function OrphanTable({
  part,
  language,
  orphans,
  playing,
  toggle,
}: {
  part: string
  language?: string
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
                  onClick={() => toggle(orphan.key, clipUrl(part, orphan.file, language))}
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
 * saving an empty one goes back to the style. While editing, Hear it plays the line said with the
 * cue as typed (a take, nothing saved), so a cue is heard before it is kept.
 */
function CueCell({
  partId,
  line,
  language,
  names,
  playing,
  toggle,
}: {
  partId: string
  line: LineState
  /** The language of the line, in a project with several. */
  language?: string
  /** In a language besides the source: its name and the source's, for what the cue says it follows. */
  names: { language: string; source: string } | null
  playing: string | null
  toggle: (id: string, url: string) => void
}) {
  const save = useSetCue(partId, language)
  const hear = useTryCue(partId, language)
  const [draft, setDraft] = useState<string | null>(null)
  // The take playing from this cell, so Hear it reads Stop while it plays.
  const tryId = `try/${line.key}`
  const heard = hear.data?.ok ? hear.data : null
  const refused = hear.data && !hear.data.ok ? hear.data : null
  const tryIt = () => {
    if (playing === tryId) return toggle(tryId, '')
    hear.mutate(
      { key: line.key, cue: draft ?? '' },
      { onSuccess: (result) => result.ok && toggle(tryId, takeUrl(result.key)) },
    )
  }
  const cell = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const problems = save.data && !save.data.ok && 'problems' in save.data ? save.data.problems : []
  const own = line.cueFrom === 'own' ? line.cue : ''
  const note = names ? cueNote(line.cueFrom, displayName(line.speaker), names.source) : null
  const hint = names ? cueHint(line.cueFrom, line.sourceCue, names.source) : null

  // Back on the cue after editing, so the keyboard keeps its place in the table.
  useEffect(() => {
    if (draft === null && refocus.current) {
      refocus.current = false
      cell.current?.focus()
    }
  }, [draft])

  // A try still playing stops when the row leaves the table (a filter or search changed).
  const playingNow = useRef(playing)
  playingNow.current = playing
  useEffect(
    () => () => {
      if (playingNow.current === tryId) toggle(tryId, '')
    },
    [tryId, toggle],
  )

  const close = () => {
    refocus.current = true
    if (playing === tryId) toggle(tryId, '')
    hear.reset()
    setDraft(null)
  }
  const done = (result: { ok: boolean }) => result.ok && close()

  if (draft === null) {
    return (
      <>
        <button
          ref={cell}
          type="button"
          className={`cue-button mono${line.cueFrom === 'own' ? '' : ' from-style'}`}
          title={
            names
              ? cueButtonTitle(line.cueFrom, names.language, names.source)
              : line.cueFrom === 'own'
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
        {note && <span className="cue-from muted">{note}</span>}
      </>
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
        placeholder={line.cueFrom === 'own' ? '' : line.cue || '[a cue for this line]'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      />
      {hint && <span className="cue-hint muted">{hint}</span>}
      <div className="cue-actions">
        <button className="btn" type="submit" disabled={save.isPending || draft.trim() === own}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {line.cueFrom === 'own' && (
          <button
            className="btn"
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ key: line.key, cue: '' }, { onSuccess: done })}
          >
            {names && line.sourceCue ? `Follow ${names.source}` : 'Use style'}
          </button>
        )}
        <button className="btn" type="button" onClick={close}>
          Cancel
        </button>
        <button
          className="btn"
          type="button"
          title="Hear the line said with this cue, without saving anything (a free take)"
          disabled={hear.isPending}
          onClick={tryIt}
        >
          {hear.isPending ? 'Recording…' : playing === tryId ? 'Stop' : 'Hear it'}
        </button>
      </div>
      {heard && playing === tryId && <span className="muted cue-tried mono">{heard.spoken}</span>}
      {problems.length > 0 && <Problems title="The cue could not be saved" problems={problems} />}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
      {refused && 'problems' in refused && (
        <Problems title="The cue could not be tried" problems={refused.problems} />
      )}
      {refused && 'message' in refused && <span className="adopt-error">{refused.message}</span>}
      {hear.isError && <span className="adopt-error">{hear.error.message}</span>}
    </form>
  )
}

/**
 * The user's note on a line ("too fast", "retake after the rewrite"), under its text: shown when
 * there is one, else an Add note link; edited in place. The studio's own, kept in the tool cache.
 */
function NoteCell({
  partId,
  lineKey,
  language,
  note,
}: {
  partId: string
  lineKey: string
  language?: string
  note: string
}) {
  const save = useSetNote(partId, language)
  const [draft, setDraft] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  // Back on the note after editing, so the keyboard keeps its place in the table.
  useEffect(() => {
    if (draft === null && refocus.current) {
      refocus.current = false
      button.current?.focus()
    }
  }, [draft])
  const open = (text: string) => {
    save.reset()
    setDraft(text)
  }
  const close = () => {
    refocus.current = true
    setDraft(null)
  }
  const problems = save.data && !save.data.ok && 'problems' in save.data ? save.data.problems : []
  const refused = save.data && !save.data.ok && !('problems' in save.data)
  if (draft === null) {
    return note ? (
      <button
        ref={button}
        type="button"
        className="note-button"
        title="Your note on this line: edit"
        onClick={() => open(note)}
      >
        {note}
      </button>
    ) : (
      <button
        ref={button}
        type="button"
        className="note-add"
        title="A note to yourself about this line, kept on this machine only"
        onClick={() => open('')}
      >
        Add note
      </button>
    )
  }
  return (
    <form
      className="note-edit"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate({ key: lineKey, note: draft }, { onSuccess: (r) => r.ok && close() })
      }}
    >
      <input
        autoFocus
        aria-label={`Note on ${lineKey}`}
        placeholder="e.g. too fast; retake after the rewrite"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      />
      <div className="cue-actions">
        <button className="btn" type="submit" disabled={save.isPending || draft.trim() === note}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {note && (
          <button
            className="btn"
            type="button"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ key: lineKey, note: '' }, { onSuccess: (r) => r.ok && close() })
            }
          >
            Remove
          </button>
        )}
        <button className="btn" type="button" onClick={close}>
          Cancel
        </button>
      </div>
      {problems.length > 0 && <Problems title="The note could not be saved" problems={problems} />}
      {refused && <span className="adopt-error">The project file cannot be read.</span>}
      {save.isError && <span className="adopt-error">{save.error.message}</span>}
    </form>
  )
}
