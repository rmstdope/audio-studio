import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import {
  bannerWords,
  doneWords,
  failureBody,
  questionItems,
  type Take,
} from '../../core/retirement'
import { useSwitchModels } from '../api'
import { noticeReducer, startNotice } from '../retirementNotice'
import { clearSwitched, useSwitchedTakes } from '../retirementSwitched'
import { Confirm } from './Confirm'

/** Text with the model names and the project file's name set in the mono face. */
function Words({ text, file }: { text: string; file: string }) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(s2\\.1-pro|s1|${escaped})`))
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

/** A coloured box with a heading and a body, and its buttons below on a narrow window. */
function Box({
  kind,
  role,
  heading,
  children,
  actions,
}: {
  kind: 'warn' | 'ok' | 'err'
  role: 'status' | 'alert'
  heading: string
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <section className={`notice notice-${kind}`} role={role}>
      <div className="notice-text">
        <strong>{heading}</strong>
        <span className="muted">{children}</span>
      </div>
      <div className="notice-actions">{actions}</div>
    </section>
  )
}

/**
 * The warning that s1 retires, with its switch to s2.1-pro: banner, question, saving, done and
 * failed. `takes` are the takes the project file names s1 for now; `onNotNow` hides the banner
 * until the page is opened again (the caller keeps that).
 */
export function RetirementNotice({
  takes,
  file,
  now,
  onNotNow,
}: {
  takes: Take[]
  file: string
  now: Date
  onNotNow: () => void
}) {
  const [state, dispatch] = useReducer(noticeReducer, startNotice)
  const switching = useSwitchModels()
  const switched = useSwitchedTakes()
  const switchButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const dismissButton = useRef<HTMLButtonElement>(null)
  const retryButton = useRef<HTMLButtonElement>(null)
  const previous = useRef(state.phase)

  useEffect(() => {
    const was = previous.current
    previous.current = state.phase
    if (was === state.phase) return
    if (state.phase === 'question') confirmButton.current?.focus()
    else if (state.phase === 'done') dismissButton.current?.focus()
    else if (state.phase === 'failed') retryButton.current?.focus()
    else if (state.phase === 'banner') {
      if (was === 'done') focusHeading()
      else switchButton.current?.focus()
    }
  }, [state.phase])

  const save = (which: Take[]) => {
    dispatch({ type: 'save' })
    switching.mutate(which, {
      onSuccess: (result) => {
        if (result.ok) dispatch({ type: 'saved' })
        else dispatch({ type: 'failed', reason: result.problems[0]?.message ?? 'refused' })
      },
      onError: (error) => dispatch({ type: 'failed', reason: error.message }),
    })
  }

  // The page's own reading of the file, since a refusal may mean it changed: nothing on s1 now
  // means nothing to switch.
  const tryAgain = () => (takes.length > 0 ? save(takes) : dispatch({ type: 'keep' }))

  if (state.phase === 'done') {
    return (
      <Box
        kind="ok"
        role="status"
        heading="Switched to s2.1-pro"
        actions={
          <button
            ref={dismissButton}
            className="btn btn-ghost"
            type="button"
            onClick={() => dispatch({ type: 'dismiss' })}
          >
            Dismiss
          </button>
        }
      >
        <Words text={doneWords(state.takes, file)} file={file} />
      </Box>
    )
  }

  if (state.phase === 'failed') {
    return (
      <Box
        kind="err"
        role="alert"
        heading="Could not switch to s2.1-pro"
        actions={
          <>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => dispatch({ type: 'keep' })}
            >
              Keep s1 for now
            </button>
            <button
              ref={retryButton}
              className="btn btn-primary"
              type="button"
              onClick={() => tryAgain()}
            >
              Try again
            </button>
          </>
        }
      >
        <Words text={failureBody(file, state.reason)} file={file} />
      </Box>
    )
  }

  if (state.phase === 'question' || state.phase === 'saving') {
    const saving = state.phase === 'saving'
    return (
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !saving) dispatch({ type: 'keep' })
        }}
      >
        <Confirm
          title="Switch this project to s2.1-pro?"
          effects={questionItems(state.takes, file).map((item) => (
            <Words text={item} file={file} />
          ))}
          back="Keep s1 for now"
          onBack={() => dispatch({ type: 'keep' })}
          backDisabled={saving}
        >
          <button
            ref={confirmButton}
            className="btn btn-primary"
            type="button"
            disabled={saving}
            onClick={() => save(state.takes)}
          >
            {saving ? 'Switching…' : 'Switch to s2.1-pro'}
          </button>
        </Confirm>
      </div>
    )
  }

  // The last take left s1 through the Models panel: the same confirmation as the banner's switch.
  if (takes.length === 0 && switched.length > 0) {
    return (
      <Box
        kind="ok"
        role="status"
        heading="Switched to s2.1-pro"
        actions={
          <button className="btn btn-ghost" type="button" onClick={() => clearSwitched()}>
            Dismiss
          </button>
        }
      >
        <Words text={doneWords(switched, file)} file={file} />
      </Box>
    )
  }
  if (takes.length === 0) return null
  const words = bannerWords(takes, now)
  return (
    <Box
      kind="warn"
      role="status"
      heading={words.heading}
      actions={
        <>
          <button className="btn btn-ghost" type="button" onClick={onNotNow}>
            Not now
          </button>
          <button
            ref={switchButton}
            className="btn btn-primary"
            type="button"
            onClick={() => dispatch({ type: 'ask', takes })}
          >
            Switch to s2.1-pro
          </button>
        </>
      }
    >
      <Words text={words.body} file={file} />
    </Box>
  )
}

/** Moves focus to the page's main heading, which is not in the tab order itself. */
function focusHeading() {
  const heading = document.querySelector<HTMLElement>('main h1')
  if (!heading) return
  heading.tabIndex = -1
  heading.focus()
}
