import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { usd } from '../../core/spend'
import type { CreditResult } from '../../services/fish'
import { boxState, payLabel } from '../sitting'

/**
 * The box that asks how much a paid audition may spend before it does: the points about what is
 * charged, an editable "Spend up to" amount beside the account's credit, and Cancel / Pay. When
 * the credit cannot be read, or cannot pay for one take, it says why the audition can't start and
 * offers Try again. Focus lands in the amount when it opens; Enter pays a valid amount; Escape and
 * Cancel close it and give focus back to the button that opened it.
 */
export function SpendConfirm({
  title,
  points,
  model,
  perTake,
  suggested,
  credit,
  onRetry,
  busy,
  failure,
  onPay,
  onCancel,
}: {
  title: string
  /** The points, as a function of the amount typed (a valid one, else the suggested). */
  points: (amount: number) => string[]
  model: string
  perTake: number
  suggested: number
  /** The credit as the server read it; undefined while it is being read. */
  credit: CreditResult | undefined
  /** Reads the credit again. */
  onRetry: () => void
  busy: boolean
  /** Why paying did nothing, if it did not. */
  failure?: string
  onPay: (amount: number) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(suggested.toFixed(2))
  const field = useRef<HTMLInputElement>(null)
  const opener = useRef<Element | null>(document.activeElement)
  const fieldId = useId()
  const state = boxState(
    credit === undefined ? undefined : credit.ok ? credit.credit : null,
    { model, perTake },
    text,
  )

  useEffect(() => field.current?.focus(), [state.kind])

  const cancel = () => {
    onCancel()
    if (opener.current instanceof HTMLElement) opener.current.focus()
  }
  const pay = (event: FormEvent) => {
    event.preventDefault()
    if (state.kind === 'ask' && state.canPay && state.amount !== null && !busy) onPay(state.amount)
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancel()
  }

  if (state.kind === 'cant') {
    return (
      <section
        className="panel confirm spend-confirm"
        role="alertdialog"
        aria-label="The audition can't start"
        onKeyDown={escape}
      >
        <h2 className="section-title">The audition can’t start</h2>
        <p className="spend-reason">{state.message}</p>
        <div className="confirm-actions">
          <button className="btn btn-ghost" type="button" onClick={cancel}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" autoFocus onClick={onRetry}>
            Try again
          </button>
        </div>
      </section>
    )
  }

  const amount = state.kind === 'ask' && state.amount !== null ? state.amount : suggested
  return (
    <form
      className="panel confirm spend-confirm"
      role="alertdialog"
      aria-label={title}
      onSubmit={pay}
      onKeyDown={escape}
    >
      <h2 className="section-title">{title}</h2>
      <ul className="confirm-effects">
        {points(amount).map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="spend-field">
        <label htmlFor={fieldId}>Spend up to</label>
        <span className="spend-input">
          <span aria-hidden="true">$</span>
          <input
            id={fieldId}
            ref={field}
            className="search"
            inputMode="decimal"
            value={text}
            aria-invalid={state.kind === 'ask' && state.problem !== null}
            onChange={(event) => setText(event.target.value)}
          />
        </span>
        <span className="muted">
          {state.kind === 'ask' ? `Your credit: ${usd(state.credit)}` : 'Reading your credit…'}
        </span>
      </div>
      {state.kind === 'ask' && state.problem && (
        <span className="adopt-error" role="alert">
          {state.problem}
        </span>
      )}
      {failure && <span className="adopt-error">{failure}</span>}
      <div className="confirm-actions">
        <button className="btn btn-ghost" type="button" onClick={cancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={state.kind !== 'ask' || !state.canPay || busy}
        >
          {payLabel(text)}
        </button>
      </div>
    </form>
  )
}
