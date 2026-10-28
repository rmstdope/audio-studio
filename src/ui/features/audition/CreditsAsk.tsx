import { useEffect, useId, useState, type FormEvent } from 'react'
import { parseCredits } from '../../../core/sitting'
import { useElevenAccount } from '../../api'
import { creditsLabel, creditsPoints, creditsWaitLine, planLeftLine } from '../../sitting'

/**
 * The bar above the voices that asks for ElevenLabs credits, while ElevenLabs voices on the board
 * wait for them: how many wait, what a take costs, an editable "Use up to" beside what is left on
 * the plan (read when the bar opens), and the button that gives them. Fish's dollars are not
 * touched.
 */
export function CreditsAsk({
  model,
  perTake,
  suggested,
  waiting,
  busy,
  failure,
  onGive,
}: {
  /** ElevenLabs' audition model. */
  model: string
  /** A take's credits on it. */
  perTake: number
  suggested: number
  /** How many ElevenLabs voices on the board wait for credits. */
  waiting: number
  busy: boolean
  /** Why giving them did nothing, if it did not. */
  failure?: string
  onGive: (credits: number) => void
}) {
  const [text, setText] = useState(String(suggested))
  const fieldId = useId()
  const account = useElevenAccount()
  const { refetch } = account
  // What is left on the plan may have changed since it was last read: ask when the bar opens.
  useEffect(() => void refetch(), [refetch])
  const given = parseCredits(text)
  const give = (event: FormEvent) => {
    event.preventDefault()
    if (given !== null && !busy) onGive(given)
  }
  const plan = account.isFetching ? undefined : account.data
  return (
    <form className="credits-ask" aria-label="Credits for ElevenLabs voices" onSubmit={give}>
      <strong>{creditsWaitLine(waiting)}</strong>
      <ul className="confirm-effects">
        {creditsPoints(model, perTake).map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="spend-field">
        <label htmlFor={fieldId}>Use up to</label>
        <span className="spend-input">
          <input
            id={fieldId}
            className="search"
            inputMode="numeric"
            value={text}
            aria-invalid={given === null}
            onChange={(event) => setText(event.target.value)}
          />
          <span aria-hidden="true">credits</span>
        </span>
        <span className="muted">
          {account.isError
            ? `What is left on your plan is unknown: ${account.error.message}`
            : planLeftLine(plan?.account, plan?.held ?? 0)}
        </span>
        <button className="btn btn-primary" type="submit" disabled={given === null || busy}>
          {creditsLabel(text)}
        </button>
      </div>
      {given === null && <span className="adopt-error">Enter whole credits, like 500.</span>}
      {failure && (
        <span className="adopt-error" role="alert">
          {failure}
        </span>
      )}
    </form>
  )
}
