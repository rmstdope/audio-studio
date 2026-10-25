import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { AuditionSession } from '../../../core/audition'
import { cloneState, formatLength, type Recording } from '../../../core/cloneVoice'
import type { Appearance } from '../../../core/summary'
import {
  recordVoiceTake,
  takeUrl,
  useCastOwnVoice,
  useCloneVoice,
  useParts,
  useSessionAction,
  useSetup,
} from '../../api'
import { audioSeconds } from '../../audioLength'
import { castEffects } from '../../board'
import { Confirm } from '../../components/Confirm'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { recordedLinesOf } from '../../inGame'
import { routeHref } from '../../route'

/** A file chosen for the voice, with its length read in the browser (null: not audio). */
interface Chosen extends Recording {
  file: File
}

/** What the new voice's sample is: being recorded, recorded (its take's key), or failed. */
type Sample = 'recording' | { key: string } | { error: string }

/** The id of the button that opens the form, found again by id as casting moves it elsewhere. */
const OPENER_ID = 'clone-voice-open'

/** What is said when the project's own files stop an action. */
const PROJECT = 'The project’s files need fixing.'

/** The sentence shown while the voice is being made, and when leaving. */
const LEAVING =
  'The voice is still being made. If you leave, it is still made on your Fish account, but you won’t see it here.'

/** Asks before the page is left (reload, close, another page of the studio) while `active`. */
function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = LEAVING
    }
    // A click on a link inside the studio is asked about before it goes anywhere, so the page
    // never changes under the form; the back button, which cannot be stopped, is asked after.
    let here = window.location.hash
    const click = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest('a[href^="#"]')
      if (!link) return
      if (window.confirm(LEAVING)) here = link.getAttribute('href') ?? here
      else {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const hashChange = () => {
      if (window.location.hash === here) return
      if (window.confirm(LEAVING)) here = window.location.hash
      else window.location.hash = here
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    window.addEventListener('hashchange', hashChange)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
      window.removeEventListener('hashchange', hashChange)
    }
  }, [active])
}

/**
 * Cloning a voice from recordings, on the character's Voice panel: the button, then in place the
 * form (name, recordings, permission), the wait, and the card of the voice made, which can be
 * cast, brought into the audition, or left on the Fish account.
 */
export function CloneVoice({
  characterId,
  name,
  currentTitle,
  parts,
  inProgress,
  sessionKnown,
  playing,
  toggle,
  language,
  languageName,
}: {
  characterId: string
  name: string
  /** The language it is cast for, in a project with several; left out otherwise. */
  language?: string
  languageName?: string
  /** The title of the voice cast now, if there is one. */
  currentTitle: string | null
  /** The character's parts, for the lines casting makes stale. */
  parts: { id: string; title: string }[]
  /** The audition going on, if any. */
  inProgress: AuditionSession | null
  /** Whether the audition has been read, so it is known whether one is going on. */
  sessionKnown: boolean
  playing: string | null
  toggle: (id: string, url: string) => void
}) {
  const setup = useSetup()
  const noKey =
    setup.data?.ok === true &&
    setup.data.checks.some((c) => c.id === 'key' && c.state === 'problem')
  const clone = useCloneVoice(characterId)
  const [mode, setMode] = useState<'closed' | 'form' | 'cloning' | 'made'>('closed')
  const [title, setTitle] = useState(name)
  const [chosen, setChosen] = useState<Chosen[]>([])
  const [permitted, setPermitted] = useState(false)
  const [refused, setRefused] = useState<{ message: string; made: 'no' | 'unknown' } | null>(null)
  const [made, setMade] = useState<{ id: string; name: string } | null>(null)
  const [sample, setSample] = useState<Sample>('recording')
  const [confirming, setConfirming] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const castButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useLeaveWarning(mode === 'cloning')

  const state = cloneState({ files: chosen, name: title, permitted })

  useEffect(() => {
    if (mode === 'form') nameField.current?.focus()
  }, [mode])
  useEffect(() => {
    if (mode === 'made') castButton.current?.focus()
  }, [mode])
  const cannotSpeak = typeof sample === 'object' && 'error' in sample
  useEffect(() => {
    if (cannotSpeak && !confirming) closeButton.current?.focus()
  }, [cannotSpeak, confirming])

  function close() {
    setMode('closed')
    setConfirming(false)
    setChosen([])
    setPermitted(false)
    setRefused(null)
    setMade(null)
    setTitle(name)
    // After the form is gone, the button is back.
    setTimeout(() => document.getElementById(OPENER_ID)?.focus(), 0)
  }

  async function add(files: File[]) {
    const read = await Promise.all(
      files.map(async (file) => ({ file, name: file.name, seconds: await audioSeconds(file) })),
    )
    setChosen((now) => [...now, ...read])
  }

  function drop(event: DragEvent) {
    event.preventDefault()
    if (mode === 'cloning') return
    void add([...event.dataTransfer.files])
  }

  async function submit() {
    setRefused(null)
    setMode('cloning')
    try {
      const result = await clone.mutateAsync({
        title: title.trim(),
        files: state.sendable.map((i) => chosen[i]!.file),
      })
      if (!result.ok) {
        setRefused({
          message: 'message' in result ? result.message : 'the project’s files need fixing',
          made: 'reason' in result && result.reason === 'failed' ? 'unknown' : 'no',
        })
        setMode('form')
        return
      }
      setMade(result.voice)
      setSample('recording')
      setMode('made')
      void recordVoiceTake(characterId, result.voice.id, language).then(
        (take) =>
          setSample(
            take.ok
              ? { key: take.key }
              : { error: 'message' in take ? take.message : 'the project’s files need fixing' },
          ),
        (error: unknown) =>
          setSample({ error: error instanceof Error ? error.message : String(error) }),
      )
    } catch (error) {
      setRefused({
        message: error instanceof Error ? error.message : String(error),
        made: 'unknown',
      })
      setMode('form')
    }
  }

  const button = (
    <button
      id={OPENER_ID}
      className="btn"
      type="button"
      disabled={noKey}
      onClick={() => setMode('form')}
    >
      Clone a voice from recordings
    </button>
  )

  if (mode === 'closed') {
    return (
      <span className="clone-open">
        {button}
        {noKey && (
          <span className="muted">
            Needs a Fish Audio key — see <a href={routeHref({ view: 'setup' })}>Setup</a>.
          </span>
        )}
      </span>
    )
  }

  if (mode === 'made' && made) {
    return (
      <div className="clone-card">
        <div className="clone-card-voice">
          {typeof sample === 'object' && 'key' in sample ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={playing === `clone:${made.id}` ? 'Stop' : `Play ${made.name}`}
              onClick={() => toggle(`clone:${made.id}`, takeUrl(sample.key))}
            >
              {playing === `clone:${made.id}` ? <PauseIcon /> : <PlayIcon />}
            </button>
          ) : (
            <button type="button" className="icon-btn" aria-label="Play" disabled>
              <PlayIcon />
            </button>
          )}
          <span>
            <strong>{made.name}</strong> <span className="chip">your voice</span>
            <span className="muted block">Made on your Fish account, private.</span>
          </span>
        </div>
        {cannotSpeak && !confirming ? (
          <>
            <span className="adopt-error">
              The voice was made, but Fish will not speak with it on your account: {sample.error}. A
              private voice may need a paid Fish account.
            </span>
            <div className="clone-actions">
              <button ref={closeButton} className="btn" type="button" onClick={close}>
                Close
              </button>
            </div>
          </>
        ) : confirming ? (
          <CastOwnConfirm
            characterId={characterId}
            language={language}
            languageName={languageName}
            name={name}
            current={currentTitle}
            voice={made}
            parts={parts}
            inProgress={inProgress}
            onBack={() => setConfirming(false)}
            onCast={close}
          />
        ) : (
          <CardButtons
            characterId={characterId}
            language={language}
            name={name}
            currentTitle={currentTitle}
            voice={made}
            inProgress={inProgress}
            sessionKnown={sessionKnown}
            castButton={castButton}
            onCast={() => setConfirming(true)}
            onClose={close}
          />
        )}
      </div>
    )
  }

  const cloning = mode === 'cloning'
  return (
    <form
      className="clone-form"
      aria-label="Clone a voice from recordings"
      onSubmit={(event) => {
        event.preventDefault()
        if (state.canClone && !cloning) void submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !cloning) close()
      }}
    >
      <span className="label">Voice · clone from recordings</span>
      <p className="muted">
        Makes a private voice on your Fish account from speech you have recorded. Only you can use
        it.
      </p>
      <label className="clone-field">
        <span className="label">Name of the voice</span>
        <input
          ref={nameField}
          className="search"
          value={title}
          disabled={cloning}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="clone-field">
        <span className="label">Recordings</span>
        <div className="clone-drop" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
          <span>
            {chosen.length ? 'Drop more files here, or' : 'Drop audio files here, or'}{' '}
            <input
              ref={picker}
              type="file"
              accept="audio/*"
              multiple
              hidden
              onChange={(event) => {
                void add([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <button
              className="btn btn-small"
              type="button"
              disabled={cloning}
              onClick={() => picker.current?.click()}
            >
              Choose files…
            </button>
          </span>
          <span className="muted">
            1 to 20 files, at least 10 seconds each. A minute or two in all gives the closest
            likeness.
          </span>
        </div>
        {chosen.length > 0 && (
          <ul className="clone-files">
            {chosen.map((c, i) => (
              <li key={`${i}-${c.name}`} className={state.marks[i] === 'sent' ? '' : 'left-out'}>
                <span className="clone-file-name" title={c.name}>
                  {c.name}
                </span>
                <span className="muted">
                  {c.seconds !== null && formatLength(c.seconds)}
                  {state.marks[i] === 'short' && ' · under 10 s — left out'}
                  {state.marks[i] === 'not-audio' && 'not an audio file — left out'}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  title={`Remove ${c.name}`}
                  aria-label={`Remove ${c.name}`}
                  disabled={cloning}
                  onClick={() => setChosen((now) => now.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {state.total && <span className="muted">{state.total}</span>}
        {state.note && <span className="adopt-error">{state.note}</span>}
      </div>
      <label className="clone-permit">
        <input
          type="checkbox"
          checked={permitted}
          disabled={cloning}
          onChange={(event) => setPermitted(event.target.checked)}
        />
        <span>These recordings are mine, or I have permission to clone this voice.</span>
      </label>
      {refused && (
        <span className="adopt-error">
          {refused.made === 'no'
            ? `Fish Audio could not make the voice: ${refused.message}. Nothing was made; your recordings are still here.`
            : `Cloning did not finish: ${refused.message}. The voice may or may not have been made on your Fish account; your recordings are still here.`}
        </span>
      )}
      {cloning && (
        <span className="muted" role="status">
          Sending {state.sendable.length} {state.sendable.length === 1 ? 'recording' : 'recordings'}{' '}
          to Fish and making the voice… this can take a minute.
        </span>
      )}
      <div className="clone-actions">
        <button className="btn btn-primary" type="submit" disabled={!state.canClone || cloning}>
          {cloning ? 'Cloning…' : 'Clone voice'}
        </button>
        {!cloning && (
          <button className="btn btn-ghost" type="button" onClick={close}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

/** The card's buttons: cast, bring into the audition, close. */
function CardButtons({
  characterId,
  language,
  name,
  currentTitle,
  voice,
  inProgress,
  sessionKnown,
  castButton,
  onCast,
  onClose,
}: {
  characterId: string
  language?: string
  name: string
  currentTitle: string | null
  voice: { id: string; name: string }
  inProgress: AuditionSession | null
  /** Whether it is known if an audition is going on: starting would replace one. */
  sessionKnown: boolean
  castButton: React.RefObject<HTMLButtonElement | null>
  onCast: () => void
  onClose: () => void
}) {
  const session = useSessionAction(characterId, language)
  const [error, setError] = useState<string | null>(null)

  async function bring() {
    setError(null)
    try {
      if (!inProgress) {
        const started = await session.mutateAsync({ action: 'start' })
        if (!started.ok) return setError('message' in started ? started.message : PROJECT)
      }
      const added = await session.mutateAsync({ action: 'add', body: { voice: voice.id } })
      if (!added.ok) return setError('message' in added ? added.message : PROJECT)
      window.location.hash = routeHref({
        view: 'audition',
        character: characterId,
        ...(language ? { language } : {}),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <div className="clone-actions clone-card-buttons">
        <button ref={castButton} className="btn btn-primary" type="button" onClick={onCast}>
          {currentTitle ? `Cast instead of ${currentTitle}` : `Cast for ${name}`}
        </button>
        <button
          className="btn"
          type="button"
          disabled={session.isPending || !sessionKnown}
          onClick={() => void bring()}
        >
          Bring into the audition
        </button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <span className="adopt-error">{error}</span>}
    </>
  )
}

/** The question before casting the new voice: what changes, as when casting from the audition. */
function CastOwnConfirm({
  characterId,
  language,
  languageName,
  name,
  current,
  voice,
  parts,
  inProgress,
  onBack,
  onCast,
}: {
  characterId: string
  language?: string
  languageName?: string
  name: string
  current: string | null
  voice: { id: string; name: string }
  parts: { id: string; title: string }[]
  inProgress: AuditionSession | null
  onBack: () => void
  onCast: () => void
}) {
  const cast = useCastOwnVoice(characterId, language)
  const loaded = useParts(
    parts.map((p) => p.id),
    language,
  )
  const listed = parts.map((p, i) => {
    const data = loaded[i]?.data
    return { ...p, lines: data?.ok ? data.part.lines : null }
  })
  const recorded: Appearance[] = parts.flatMap((p) => {
    const lines = recordedLinesOf(
      listed.filter((l) => l.id === p.id),
      characterId,
    ).length
    return lines ? [{ part: p.id, lines }] : []
  })
  return (
    <Confirm
      title={
        languageName
          ? `Cast ${voice.name} as ${name}’s ${languageName} voice?`
          : `Cast ${voice.name} as ${name}?`
      }
      back="Back"
      effects={castEffects({
        name,
        current,
        replacing: true,
        recorded,
        titles: new Map(parts.map((p) => [p.id, p.title])),
        dropped: inProgress?.dropped.length ?? 0,
        unheard: inProgress ? inProgress.toHear.length + inProgress.queue.length : 0,
        auditioning: inProgress !== null,
        ...(languageName ? { language: languageName } : {}),
      })}
      onBack={onBack}
    >
      <button
        className="btn btn-primary"
        type="button"
        disabled={cast.isPending}
        onClick={() => cast.mutate(voice, { onSuccess: (r) => r.ok && onCast() })}
      >
        {cast.isPending ? 'Casting…' : `Cast ${voice.name}`}
      </button>
      {cast.data && !cast.data.ok && 'message' in cast.data && (
        <span className="adopt-error">{cast.data.message}</span>
      )}
      {cast.isError && <span className="adopt-error">{cast.error.message}</span>}
    </Confirm>
  )
}
