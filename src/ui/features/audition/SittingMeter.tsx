import { useState, type FormEvent } from 'react'
import { parseAmount, type SittingMoney } from '../../../core/sitting'
import { usd } from '../../../core/spend'
import { meterLine, payLabel, usedUpLine } from '../../sitting'

/**
 * The paid audition's money, always in view above the voices: a model badge, how much of the
 * sitting is used and how many takes are left, and a bar. When it is used up, the bar is replaced
 * by one that says how many voices wait for a take and asks for more money to add.
 */
export function SittingMeter({
  model,
  money,
  waiting,
  suggested,
  busy,
  failure,
  onAdd,
}: {
  model: string
  money: SittingMoney
  /** How many voices on the board have no take yet for want of money. */
  waiting: number
  suggested: number
  busy: boolean
  failure?: string
  onAdd: (amount: number) => void
}) {
  const [text, setText] = useState(suggested.toFixed(2))
  const amount = parseAmount(text)
  const add = (event: FormEvent) => {
    event.preventDefault()
    if (amount !== null && !busy) onAdd(amount)
  }
  if (money.usedUp) {
    return (
      <form className="sitting-meter used-up" aria-label="The audition's money" onSubmit={add}>
        <span className="sitting-words">
          <span className="chip">{model}</span>
          <strong>{usedUpLine(money.dollars, waiting)}</strong>
        </span>
        <span className="sitting-add">
          <label htmlFor="sitting-add">Add</label>
          <span className="spend-input">
            <span aria-hidden="true">$</span>
            <input
              id="sitting-add"
              className="search"
              inputMode="decimal"
              value={text}
              aria-invalid={amount === null}
              onChange={(event) => setText(event.target.value)}
            />
          </span>
          <button className="btn btn-primary" type="submit" disabled={amount === null || busy}>
            {payLabel(text, true)}
          </button>
        </span>
        {amount === null && (
          <span className="adopt-error">Enter an amount in dollars, like 0.10.</span>
        )}
        {failure && <span className="adopt-error">{failure}</span>}
      </form>
    )
  }
  const used = money.dollars > 0 ? Math.min(1, money.spent / money.dollars) : 0
  return (
    <div className="sitting-meter" role="group" aria-label="The audition's money">
      <span className="sitting-words">
        <span className="chip">{model}</span>
        <span>{meterLine(money)}</span>
      </span>
      <div
        className="sitting-bar"
        role="progressbar"
        aria-label={`${usd(money.spent)} of ${usd(money.dollars)} used`}
        aria-valuemin={0}
        aria-valuemax={money.dollars}
        aria-valuenow={money.spent}
      >
        <span style={{ width: `${(used * 100).toFixed(1)}%` }} />
      </div>
    </div>
  )
}
