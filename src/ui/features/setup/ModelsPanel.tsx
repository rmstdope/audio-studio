import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import {
  busyWords,
  changeOf,
  failureHeading,
  modelOptions,
  priceWords,
  questionWords,
  SAME_AS_DRAFT,
  STAGES,
  type Stage,
} from '../../../core/models'
import { failureBody, RETIRED_MODEL } from '../../../core/retirement'
import {
  MUSIC_GROUPS,
  menuEntry,
  setupShortLine,
  musicModel,
  saveFailureHeading,
  type MusicModelId,
} from '../../../core/musicModels'
import { useModelsView, useSetMusicModel, useSetStageModel, type ModelsAnswer } from '../../api'
import { Confirm } from '../../components/Confirm'
import { markSwitched } from '../../retirementSwitched'
import { focusAfter, rowReducer, startRow } from '../../modelsRow'

type View = Extract<ModelsAnswer, { ok: true }>

/** Text with the model names and the project file's name set in the mono face. */
function Mono({ text, words }: { text: string; words: string[] }) {
  const escaped = [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mono">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

/**
 * The Models panel at the top of Setup: which Fish model records the audition, draft and final
 * stages, with what each costs, and a menu for each that saves the choice in the project file.
 * Shows nothing until the models are read; the page shows it only while the project file reads.
 */
export function ModelsPanel() {
  const view = useModelsView()
  const save = useSetStageModel()
  if (!view.data?.ok) return null
  const { busy } = view.data
  const locked = busy !== null || save.isPending
  return (
    <section className="panel models" aria-labelledby="models-heading">
      <h2 id="models-heading" className="section-title">
        Models
      </h2>
      <span className="muted">
        {view.data.music
          ? 'Which model records each stage of the voices, and which makes the music.'
          : 'Which Fish model records each stage.'}{' '}
        Saved in <span className="mono">{view.data.file}</span> for everyone on the project.
      </span>
      {busy && (
        <span className="models-busy" role="status">
          {busyWords(busy)}
        </span>
      )}
      {STAGES.map(({ stage, name, purpose }) => (
        <StageRow
          key={stage}
          stage={stage}
          name={name}
          purpose={purpose}
          view={view.data as View}
          locked={locked}
          save={(model, was) => save.mutateAsync({ stage, model, was })}
        />
      ))}
      {view.data.music && <MusicRow file={view.data.file} music={view.data.music} />}
    </section>
  )
}

/**
 * The Music row: the one model loops and stingers are made with unless a track asks for another,
 * a menu of whole recipes saved in the project file as soon as one is picked (nothing has to be
 * made again, so nothing is asked first). Failing is the voice rows' box.
 */
function MusicRow({ file, music }: { file: string; music: NonNullable<View['music']> }) {
  const save = useSetMusicModel()
  const [state, dispatch] = useReducer(rowReducer, startRow)
  const retry = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLSelectElement>(null)
  const previous = useRef(state)
  const lastRun = useRef('')
  const current = music.model
  const pending = state.phase === 'saving'

  useEffect(() => {
    const target = focusAfter(previous.current, state)
    previous.current = state
    if (target === 'menu') requestAnimationFrame(() => menu.current?.focus())
    else if (target === 'retry') retry.current?.focus()
  }, [state])

  // The save runs from the state's own transition, so Try again and a first pick share one path.
  useEffect(() => {
    const key = state.phase === 'saving' ? state.to : ''
    if (key && key !== lastRun.current) {
      save.mutateAsync({ model: key, was: current }).then(
        (result) =>
          result.ok
            ? dispatch({ type: 'saved' })
            : dispatch({ type: 'failed', reason: result.problems?.[0]?.message ?? 'refused' }),
        (error: Error) => dispatch({ type: 'failed', reason: error.message }),
      )
    }
    lastRun.current = key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const shown = (state.phase === 'saving' ? state.to : current) as MusicModelId
  const here = music.installed[shown]
  const shortLine = setupShortLine(shown, music.loops)
  return (
    <div className="mrow">
      <div className="mname">Music</div>
      <div className="mtx">
        <span className="muted">
          Loops and stingers, made on this computer. A track's takes can use another.
        </span>
        <div className="mmenu">
          <select
            ref={menu}
            aria-label="Music model"
            value={shown}
            disabled={pending}
            onChange={(event) =>
              dispatch({ type: 'pick', to: event.target.value, change: { kind: 'save' } })
            }
          >
            {MUSIC_GROUPS.map((group) => (
              <optgroup key={group.heading} label={group.heading}>
                {group.ids.map((id) => (
                  <option key={id} value={id}>
                    {menuEntry(id, music.installed[id])}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="free">Free</span>
          {!here && <span className="warnline">not on this computer</span>}
          {pending && <span className="muted">Saving…</span>}
        </div>
        {shortLine && <span className="mshort faint small">{shortLine}</span>}
        {state.phase === 'failed' && (
          <section className="notice notice-err" role="alert">
            <div className="notice-text">
              <strong>{saveFailureHeading(state.to as MusicModelId)}</strong>
              <span className="muted">
                <Mono text={failureBody(file, state.reason)} words={[file]} />
              </span>
            </div>
            <div className="notice-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => dispatch({ type: 'keep' })}
              >
                Keep {musicModel(current).name}
              </button>
              <button
                ref={retry}
                className="btn btn-primary"
                type="button"
                onClick={() => dispatch({ type: 'retry' })}
              >
                Try again
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/** One stage: its name, purpose, menu and price, and the question or failure under the menu. */
function StageRow({
  stage,
  name,
  purpose,
  view,
  locked,
  save,
}: {
  stage: Stage
  name: string
  purpose: string
  view: View
  locked: boolean
  save: (model: string, was: string) => Promise<{ ok: boolean; problems?: { message: string }[] }>
}) {
  const [state, dispatch] = useReducer(rowReducer, startRow)
  const menu = useRef<HTMLSelectElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  const previous = useRef(state)
  // The model the file named when the choice was made: a retry over a changed file asks again.
  const startedFrom = useRef(view.models[stage])
  const now = new Date()
  const current = view.models[stage]

  useEffect(() => {
    const target = focusAfter(previous.current, state)
    previous.current = state
    if (target === 'confirm') confirm.current?.focus()
    else if (target === 'menu') requestAnimationFrame(() => menu.current?.focus())
    else if (target === 'retry') retry.current?.focus()
  }, [state])

  const run = (to: string) => {
    save(to, current).then(
      (result) =>
        result.ok
          ? (stage !== 'audition' && current === RETIRED_MODEL && markSwitched(stage),
            dispatch({ type: 'saved' }))
          : dispatch({ type: 'failed', reason: result.problems?.[0]?.message ?? 'refused' }),
      (error: Error) => dispatch({ type: 'failed', reason: error.message }),
    )
  }
  // The saves run from the state's own transition, so a retry and a confirm share one path.
  const lastRun = useRef<RowStateKey>('')
  useEffect(() => {
    const key: RowStateKey =
      state.phase === 'saving' || state.phase === 'switching' ? `${state.phase}:${state.to}` : ''
    if (
      key &&
      key !== lastRun.current &&
      (state.phase === 'saving' || state.phase === 'switching')
    ) {
      run(state.to)
    }
    lastRun.current = key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const pending = state.phase === 'saving' || state.phase === 'switching'
  const shown = state.phase === 'saving' ? state.to : current
  const options = modelOptions(stage, current, now)
  const price = priceWords(shown, now, view.dialog)
  const change =
    state.phase === 'asking' || state.phase === 'switching' || state.phase === 'failed'
      ? changeOf(stage, state.to, view.models, view.recorded, now)
      : null

  return (
    <div className="mrow">
      <div className="mname">{name}</div>
      <div className="mtx">
        <span className="muted">{purpose}</span>
        <div className="mmenu">
          <select
            ref={menu}
            aria-label={`${name} model`}
            className="mono"
            value={shown}
            disabled={locked || pending || state.phase === 'asking'}
            onChange={(event) => {
              const to = event.target.value
              startedFrom.current = current
              dispatch({
                type: 'pick',
                to,
                change: changeOf(stage, to, view.models, view.recorded, now),
              })
            }}
          >
            {options
              .filter((o) => !o.apart)
              .map((o) => (
                <option key={o.model} value={o.model}>
                  {o.model} — {o.label}
                </option>
              ))}
            {options.some((o) => o.apart) && <option disabled>──────────</option>}
            {options
              .filter((o) => o.apart)
              .map((o) => (
                <option key={o.model} value={o.model}>
                  {o.model} — {o.label}
                </option>
              ))}
          </select>
          <span className={price === 'Free' ? 'free' : 'price'}>{price}</span>
          {state.phase === 'saving' && <span className="muted">Saving…</span>}
        </div>
        {state.phase === 'asking' || state.phase === 'switching'
          ? change?.kind === 'ask' &&
            stage !== 'audition' && (
              <Question
                stage={stage}
                from={current}
                to={state.to}
                change={change}
                file={view.file}
                now={now}
                switching={state.phase === 'switching'}
                confirm={confirm}
                onKeep={() => dispatch({ type: 'keep' })}
                onConfirm={() => dispatch({ type: 'confirm' })}
              />
            )
          : null}
        {state.phase === 'failed' && (
          <section className="notice notice-err" role="alert">
            <div className="notice-text">
              <strong>{failureHeading(stage, state.to)}</strong>
              <span className="muted">
                <Mono text={failureBody(view.file, state.reason)} words={[view.file]} />
              </span>
            </div>
            <div className="notice-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => dispatch({ type: 'keep' })}
              >
                Keep {current}
              </button>
              <button
                ref={retry}
                className="btn btn-primary"
                type="button"
                onClick={() =>
                  dispatch({ type: startedFrom.current === current ? 'retry' : 'keep' })
                }
              >
                Try again
              </button>
            </div>
          </section>
        )}
        {stage === 'final' && view.models.final === view.models.draft && (
          <span className="muted models-same">{SAME_AS_DRAFT}</span>
        )}
      </div>
    </div>
  )
}

type RowStateKey = '' | `saving:${string}` | `switching:${string}`

/** The question under a menu before a change that makes recorded lines out of date. */
function Question({
  stage,
  from,
  to,
  change,
  file,
  now,
  switching,
  confirm,
  onKeep,
  onConfirm,
}: {
  stage: 'draft' | 'final'
  from: string
  to: string
  change: { lines: number; cost: { now: number; later: number | null } }
  file: string
  now: Date
  switching: boolean
  confirm: React.RefObject<HTMLButtonElement | null>
  onKeep: () => void
  onConfirm: () => void
}): ReactNode {
  const words = questionWords(stage, from, to, change, file, now)
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !switching) onKeep()
      }}
    >
      <Confirm
        title={words.heading}
        effects={words.items}
        back={words.keep}
        onBack={onKeep}
        backDisabled={switching}
      >
        <button
          ref={confirm}
          className="btn btn-primary"
          type="button"
          disabled={switching}
          onClick={onConfirm}
        >
          {switching ? 'Switching…' : words.confirm}
        </button>
      </Confirm>
    </div>
  )
}
