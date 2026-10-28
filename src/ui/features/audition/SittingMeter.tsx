import { useId, useState, type FormEvent } from 'react'
import { elevenModelName } from '../../../core/elevenSpeech'
import { parseAmount, parseCredits, type SittingMoney } from '../../../core/sitting'
import { usd } from '../../../core/spend'
import { credits } from '../../agreed'
import {
  creditsLabel,
  creditsMeterLine,
  creditsUsedUpLine,
  meterLine,
  payLabel,
  usedUpLine,
} from '../../sitting'

/** What each unit of a sitting's money says and reads. */
const UNITS = {
  usd: {
    label: "The audition's money",
    parse: parseAmount,
    start: (suggested: number) => suggested.toFixed(2),
    meter: meterLine,
    usedUp: usedUpLine,
    button: payLabel,
    of: (money: SittingMoney) => `${usd(money.spent)} of ${usd(money.dollars)} used`,
    invalid: 'Enter an amount in dollars, like 0.10.',
    prefix: '$',
    suffix: null,
  },
  credits: {
    label: "The audition's credits",
    parse: parseCredits,
    start: (suggested: number) => String(suggested),
    meter: creditsMeterLine,
    usedUp: creditsUsedUpLine,
    button: creditsLabel,
    of: (money: SittingMoney) =>
      `${money.spent.toLocaleString('en-US')} of ${credits(money.dollars)} used`,
    invalid: 'Enter whole credits, like 500.',
    prefix: null,
    suffix: 'credits',
  },
} as const

/**
 * A sitting's money, always in view above the voices: a model badge, how much of the sitting is
 * used and how many takes are left, and a bar; in Fish's dollars (`usd`) or ElevenLabs' credits.
 * When it is used up, the bar is replaced by one that says how many voices wait for a take and
 * asks for more to add.
 */
export function SittingMeter({
  unit = 'usd',
  model,
  money,
  waiting,
  suggested,
  busy,
  failure,
  onAdd,
}: {
  unit?: 'usd' | 'credits'
  model: string
  /** The sitting's money; for credits, its `dollars`, `spent` and `left` are credits. */
  money: SittingMoney
  /** How many voices on the board have no take yet for want of money. */
  waiting: number
  suggested: number
  busy: boolean
  failure?: string
  onAdd: (amount: number) => void
}) {
  const words = UNITS[unit]
  const [text, setText] = useState(words.start(suggested))
  const fieldId = useId()
  const amount = words.parse(text)
  const shownModel = unit === 'credits' ? elevenModelName(model) : model
  const add = (event: FormEvent) => {
    event.preventDefault()
    if (amount !== null && !busy) onAdd(amount)
  }
  if (money.usedUp) {
    return (
      <form className="sitting-meter used-up" aria-label={words.label} onSubmit={add}>
        <span className="sitting-words">
          <span className="chip">{shownModel}</span>
          <strong>{words.usedUp(money.dollars, waiting)}</strong>
        </span>
        <span className="sitting-add">
          <label htmlFor={fieldId}>Add</label>
          <span className="spend-input">
            {words.prefix && <span aria-hidden="true">{words.prefix}</span>}
            <input
              id={fieldId}
              className="search"
              inputMode={unit === 'usd' ? 'decimal' : 'numeric'}
              value={text}
              aria-invalid={amount === null}
              onChange={(event) => setText(event.target.value)}
            />
            {words.suffix && <span aria-hidden="true">{words.suffix}</span>}
          </span>
          <button className="btn btn-primary" type="submit" disabled={amount === null || busy}>
            {words.button(text, true)}
          </button>
        </span>
        {amount === null && <span className="adopt-error">{words.invalid}</span>}
        {failure && <span className="adopt-error">{failure}</span>}
      </form>
    )
  }
  const used = money.dollars > 0 ? Math.min(1, money.spent / money.dollars) : 0
  return (
    <div className="sitting-meter" role="group" aria-label={words.label}>
      <span className="sitting-words">
        <span className="chip">{shownModel}</span>
        <span>{words.meter(money)}</span>
      </span>
      <div
        className="sitting-bar"
        role="progressbar"
        aria-label={words.of(money)}
        aria-valuemin={0}
        aria-valuemax={money.dollars}
        aria-valuenow={money.spent}
      >
        <span style={{ width: `${(used * 100).toFixed(1)}%` }} />
      </div>
    </div>
  )
}
