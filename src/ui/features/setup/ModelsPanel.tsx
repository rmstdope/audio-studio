import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import {
  busyWords,
  changeOf,
  elevenChangeOf,
  elevenOptions,
  elevenQuestionWords,
  elevenSettingsChangeOf,
  elevenSettingsWords,
  sameSettings,
  settingWords,
  STABILITY,
  failureHeading,
  modelOptions,
  priceWords,
  questionWords,
  sameAsDraftWords,
  STAGES,
  type Question,
  type Stage,
} from '../../../core/models'
import { failureBody, RETIRED_MODEL } from '../../../core/retirement'
import {
  MUSIC_GROUPS,
  lacking,
  menuEntry,
  onThisComputer,
  perMinuteWords,
  setupShortLine,
  musicModel,
  saveFailureHeading,
  type MusicModelId,
} from '../../../core/musicModels'
import {
  useModelsView,
  useSetElevenModel,
  useSetElevenTts,
  useSetMusicModel,
  useSetStageModel,
  type ModelsAnswer,
} from '../../api'
import { ELEVEN_TTS, elevenModelName, readsCues } from '../../../core/elevenSpeech'
import type { ElevenTts } from '../../../core/project'
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
      {view.data.castsEleven &&
        ELEVEN_STAGES.map(({ stage, name, purpose }) => (
          <ElevenRow
            key={stage}
            stage={stage}
            name={name}
            purpose={purpose}
            view={view.data as View}
            locked={locked}
          />
        ))}
      {view.data.castsEleven && <ElevenVoiceRow view={view.data as View} locked={locked} />}
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
          {onThisComputer(shown)
            ? "Loops and stingers, made on this computer. A track's takes can use another."
            : "Loops and stingers, made by ElevenLabs in the cloud. A track's takes can use another."}
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
          {onThisComputer(shown) ? (
            <span className="free">Free</span>
          ) : (
            <span className="price">{perMinuteWords(shown) ?? 'Paid'}</span>
          )}
          {!here && <span className="warnline">{lacking(shown)}</span>}
          {pending && <span className="muted">Saving…</span>}
        </div>
        {shortLine && <span className="mshort">{shortLine}</span>}
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
          <span className="muted models-same">
            {sameAsDraftWords(view.castsEleven ? 'fish' : null)}
          </span>
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

/**
 * ElevenLabs' side of the stages the panel shows: draft and final. Its audition model, which page
 * takes and tries already use, gets its row with auditions on ElevenLabs (§12 step 14.10b).
 */
const ELEVEN_STAGES = [
  {
    stage: 'draft',
    name: 'ElevenLabs draft',
    purpose: 'Every line of a character with an ElevenLabs voice, while the game is written.',
  },
  {
    stage: 'final',
    name: 'ElevenLabs final',
    purpose: 'Those lines again, for the game you ship.',
  },
] as const

/**
 * One of ElevenLabs' stages: its menu of ElevenLabs' speech models (each with its credits a
 * character, and whether it speaks cues), saved at once, or after a question when recorded lines
 * go out of date; a failure says why, as the Fish rows do.
 */
function ElevenRow({
  stage,
  name,
  purpose,
  view,
  locked,
}: {
  stage: 'draft' | 'final'
  name: string
  purpose: string
  view: View
  locked: boolean
}) {
  const save = useSetElevenModel()
  const [state, dispatch] = useReducer(rowReducer, startRow)
  const menu = useRef<HTMLSelectElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  const previous = useRef(state)
  const lastRun = useRef('')
  const models = view.elevenlabs
  const current = models[stage]

  useEffect(() => {
    const target = focusAfter(previous.current, state)
    previous.current = state
    if (target === 'confirm') confirm.current?.focus()
    else if (target === 'menu') requestAnimationFrame(() => menu.current?.focus())
    else if (target === 'retry') retry.current?.focus()
  }, [state])

  // The save runs from the state's own transition, so a retry and a confirm share one path.
  useEffect(() => {
    const key =
      state.phase === 'saving' || state.phase === 'switching' ? `${state.phase}:${state.to}` : ''
    if (
      key &&
      key !== lastRun.current &&
      (state.phase === 'saving' || state.phase === 'switching')
    ) {
      save.mutateAsync({ stage, model: state.to, was: current }).then(
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

  const pending = state.phase === 'saving' || state.phase === 'switching'
  const shown = state.phase === 'saving' ? state.to : current
  const change =
    state.phase === 'asking' || state.phase === 'switching'
      ? elevenChangeOf(stage, state.to, models, view.recorded)
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
            value={shown}
            disabled={locked || pending || state.phase === 'asking'}
            onChange={(event) => {
              const to = event.target.value
              dispatch({
                type: 'pick',
                to,
                change: elevenChangeOf(stage, to, models, view.recorded),
              })
            }}
          >
            {elevenOptions().map((o) => (
              <option key={o.model} value={o.model}>
                {o.label}
              </option>
            ))}
          </select>
          {state.phase === 'saving' && <span className="muted">Saving…</span>}
        </div>
        {change?.kind === 'ask' && (
          <div
            onKeyDown={(event) => {
              if (event.key === 'Escape' && state.phase === 'asking') dispatch({ type: 'keep' })
            }}
          >
            {(() => {
              const words = elevenQuestionWords(
                stage,
                current,
                state.phase === 'asking' || state.phase === 'switching' ? state.to : current,
                change,
                view.file,
              )
              return (
                <Confirm
                  title={words.heading}
                  effects={words.items}
                  back={words.keep}
                  onBack={() => dispatch({ type: 'keep' })}
                  backDisabled={state.phase === 'switching'}
                >
                  <button
                    ref={confirm}
                    className="btn btn-primary"
                    type="button"
                    disabled={state.phase === 'switching'}
                    onClick={() => dispatch({ type: 'confirm' })}
                  >
                    {state.phase === 'switching' ? 'Switching…' : words.confirm}
                  </button>
                </Confirm>
              )
            })()}
          </div>
        )}
        {state.phase === 'failed' && (
          <section className="notice notice-err" role="alert">
            <div className="notice-text">
              <strong>
                Could not switch ElevenLabs {stage === 'draft' ? 'drafts' : 'final recording'} to{' '}
                {elevenModelName(state.to)}
              </strong>
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
                Keep {elevenModelName(current)}
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
        {!readsCues(shown) && (
          <span className="muted models-same">
            {elevenModelName(shown)} speaks cues aloud, so its lines are sent without them.
          </span>
        )}
        {stage === 'final' && models.final === models.draft && (
          <span className="muted models-same">{sameAsDraftWords('elevenlabs')}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Where a voice settings save is: being changed, asked about (the question as it was asked, so
 * data read meanwhile cannot take it away), saving, or failed with a reason.
 */
type VoicePhase =
  | { phase: 'editing' }
  | { phase: 'asking'; words: Question; was: ElevenTts }
  | { phase: 'saving'; words: Question | null }
  | { phase: 'failed'; reason: string }

/**
 * The ElevenLabs voice row: the settings every ElevenLabs voice speaks with (stability as Eleven
 * v3's three steps, similarity and style as sliders), changed in the row and saved with its own
 * button, at once or after a question when recorded lines go out of date. Undo puts the saved
 * settings back; ElevenLabs' defaults can be put in the row when it shows others. A change is kept
 * through a failed save, and Try again weighs it afresh against the settings saved by then.
 */
function ElevenVoiceRow({ view, locked }: { view: View; locked: boolean }) {
  const save = useSetElevenTts()
  const saved = view.elevenTts
  const [edited, setEdited] = useState<ElevenTts | null>(null)
  const [state, setState] = useState<VoicePhase>({ phase: 'editing' })
  const stability = useRef<HTMLSelectElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  const previous = useRef(state.phase)
  const shown = edited ?? saved
  const changed = !sameSettings(shown, saved)
  const disabled = locked || state.phase !== 'editing'

  useEffect(() => {
    const was = previous.current
    previous.current = state.phase
    if (state.phase === 'asking') confirm.current?.focus()
    else if (state.phase === 'failed') retry.current?.focus()
    else if (state.phase === 'editing' && was !== 'editing') {
      requestAnimationFrame(() => stability.current?.focus())
    }
  }, [state.phase])

  // Settings saved here or elsewhere replace the row's own once the panel reads them again,
  // unless a save of the row's own is under way or failed.
  const editing = state.phase === 'editing'
  useEffect(() => {
    if (editing) setEdited(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.stability, saved.similarityBoost, saved.style])

  const set = (next: Partial<ElevenTts>) => setEdited({ ...shown, ...next })
  const keep = () => {
    setEdited(null)
    setState({ phase: 'editing' })
  }
  const send = (tts: ElevenTts, was: ElevenTts, words: Question | null) => {
    setState({ phase: 'saving', words })
    save.mutateAsync({ tts, was }).then(
      (result) => {
        if (result.ok) setState({ phase: 'editing' })
        else setState({ phase: 'failed', reason: result.problems?.[0]?.message ?? 'refused' })
      },
      (error: Error) => setState({ phase: 'failed', reason: error.message }),
    )
  }
  /** Saves what the row shows over what is saved now: at once, or after the question. */
  const offer = () => {
    const change = elevenSettingsChangeOf(saved, shown, view.elevenlabs, view.recorded)
    if (change.kind === 'none') return keep()
    if (change.kind === 'save') return send(shown, saved, null)
    setState({
      phase: 'asking',
      words: elevenSettingsWords(saved, shown, change, view.file),
      was: saved,
    })
  }
  const words = state.phase === 'asking' || state.phase === 'saving' ? state.words : null
  return (
    <div className="mrow">
      <div className="mname">ElevenLabs voice</div>
      <div className="mtx">
        <span className="muted">How every ElevenLabs voice speaks, at every stage.</span>
        <div className="voice-settings">
          <label htmlFor="eleven-stability">Stability</label>
          <div className="mmenu">
            <select
              ref={stability}
              id="eleven-stability"
              aria-label="ElevenLabs stability"
              value={String(shown.stability)}
              disabled={disabled}
              onChange={(event) =>
                set({ stability: Number(event.target.value) as ElevenTts['stability'] })
              }
            >
              {STABILITY.map((s) => (
                <option key={s.value} value={String(s.value)}>
                  {s.name} · {s.hint}
                </option>
              ))}
            </select>
          </div>
          {SLIDERS.map(({ key, name, hint }) => (
            <SettingSlider
              key={key}
              name={name}
              hint={hint}
              value={shown[key]}
              shown={settingWords(key, shown[key])}
              disabled={disabled}
              onChange={(value) => set({ [key]: value })}
            />
          ))}
        </div>
        <div className="mmenu">
          {changed && (
            <>
              <button className="btn btn-ghost" type="button" disabled={disabled} onClick={keep}>
                Undo changes
              </button>
              <button className="btn btn-primary" type="button" disabled={disabled} onClick={offer}>
                Save voice settings
              </button>
            </>
          )}
          {!sameSettings(shown, ELEVEN_TTS) && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={disabled}
              onClick={() => setEdited({ ...ELEVEN_TTS })}
            >
              Use ElevenLabs' defaults
            </button>
          )}
          {state.phase === 'saving' && !words && <span className="muted">Saving…</span>}
        </div>
        {words && (
          <div
            onKeyDown={(event) => {
              if (event.key === 'Escape' && state.phase === 'asking') keep()
            }}
          >
            <Confirm
              title={words.heading}
              effects={words.items}
              back={words.keep}
              onBack={keep}
              backDisabled={state.phase === 'saving'}
            >
              <button
                ref={confirm}
                className="btn btn-primary"
                type="button"
                disabled={state.phase === 'saving'}
                onClick={() => state.phase === 'asking' && send(shown, state.was, words)}
              >
                {state.phase === 'saving' ? 'Saving…' : words.confirm}
              </button>
            </Confirm>
          </div>
        )}
        {state.phase === 'failed' && (
          <section className="notice notice-err" role="alert">
            <div className="notice-text">
              <strong>Could not save ElevenLabs' voice settings</strong>
              <span className="muted">
                <Mono text={failureBody(view.file, state.reason)} words={[view.file]} />
              </span>
            </div>
            <div className="notice-actions">
              <button className="btn btn-ghost" type="button" onClick={keep}>
                Keep the saved settings
              </button>
              <button ref={retry} className="btn btn-primary" type="button" onClick={offer}>
                Try again
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/** The voice settings shown as sliders, with what each does. */
const SLIDERS: readonly { key: 'similarityBoost' | 'style'; name: string; hint: string }[] = [
  { key: 'similarityBoost', name: 'Similarity', hint: 'how closely it keeps to the voice' },
  { key: 'style', name: 'Style', hint: "how much it exaggerates the voice's style" },
]

/** One voice setting from 0 to 1 in steps of 0.05, with its value and what it does. */
function SettingSlider({
  name,
  hint,
  value,
  shown,
  disabled,
  onChange,
}: {
  name: string
  hint: string
  value: number
  shown: string
  disabled: boolean
  onChange: (value: number) => void
}) {
  const id = `eleven-${name.toLowerCase()}`
  return (
    <>
      <label htmlFor={id}>{name}</label>
      <div className="mmenu">
        <input
          id={id}
          type="range"
          aria-label={`ElevenLabs ${name.toLowerCase()}`}
          min={0}
          max={1}
          step={0.05}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="mono">{shown}</span>
        <span className="muted models-same">{hint}</span>
      </div>
    </>
  )
}
