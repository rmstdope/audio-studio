/** Why a paid job may not start yet: what the page must do about it. */
export type SpendProblem =
  | { reason: 'confirm'; ceiling: number; message: string }
  | { reason: 'credit'; message: string }
  | { reason: 'price'; message: string }

/** An amount in dollars, as messages write it. */
function usd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/**
 * Whether a job costing at most `ceiling` dollars may start (null) or not. A free job always may.
 * A paid one needs the user to have confirmed at least its ceiling, and the account's credit to
 * cover it; with the credit unknown, or the model's price unknown, it does not start.
 */
export function spendProblem({
  ceiling,
  confirmed,
  credit,
}: {
  ceiling: number | null
  confirmed?: number
  credit?: number | null
}): SpendProblem | null {
  if (ceiling === null) {
    return { reason: 'price', message: 'The model’s price is unknown, so nothing is recorded.' }
  }
  if (ceiling === 0) return null
  if (confirmed === undefined || confirmed < ceiling) {
    return {
      reason: 'confirm',
      ceiling,
      message: `This costs up to ${usd(ceiling)} on your Fish account; confirm it to go ahead.`,
    }
  }
  if (credit === undefined || credit === null) {
    return { reason: 'credit', message: 'The account’s credit is unknown, so nothing is recorded.' }
  }
  if (credit < ceiling) {
    return {
      reason: 'credit',
      message: `This costs up to ${usd(ceiling)}, more than the ${usd(credit)} of credit left.`,
    }
  }
  return null
}
