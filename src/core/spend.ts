import { priceOf } from './prices'

/** Why a paid job may not start yet: what the page must do about it. */
export type SpendProblem =
  | { reason: 'confirm'; ceiling: number; message: string }
  | { reason: 'credit'; message: string }
  | { reason: 'price'; message: string }

/** Below this, a difference in dollars is rounding, not money (sums of per-piece prices). */
const ROUNDING = 1e-9

/** An amount in dollars, as messages and the page write it. */
export function usd(amount: number): string {
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
  // A confirmation in whole cents may sit a rounding hair below a ceiling worked out in floats.
  if (confirmed === undefined || confirmed + ROUNDING < ceiling) {
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

/**
 * What one confirmed recording may still spend: the model it was confirmed for, and the dollars
 * left. Checked right before every request to Fish, priced at that moment, so nothing changed
 * after the confirmation (the model, the text, the takes, a promotion ending) can spend more.
 */
export interface Budget {
  readonly model: string
  /** The dollars it was given. */
  readonly dollars: number
  /** Dollars left to spend. */
  readonly left: number
  /** Dollars charged so far, less refunds: what was given less what is left. */
  readonly spent: number
  /**
   * Takes `bytes` of text on `model` at `at` out of the budget: null if it fits, else why not (and
   * nothing is taken).
   */
  spend(model: string, bytes: number, at: Date): string | null
  /** Adds `dollars` to what it was given and to what is left (a top-up). */
  add(dollars: number): void
  /** Gives back `dollars` of what a request cost that was not billed; what it was given stays. */
  refund(dollars: number): void
}

/** A budget for `model` with `dollars` to spend (none, for the free model). */
export function createBudget({ model, dollars }: { model: string; dollars: number }): Budget {
  let left = dollars
  let given = dollars
  return {
    model,
    get dollars() {
      return given
    },
    get left() {
      return left
    },
    get spent() {
      return given - left
    },
    spend(asked, bytes, at) {
      if (asked !== model) {
        return `the project now names ${asked}, but ${model} was confirmed; plan again`
      }
      const price = priceOf(asked, at)
      if (price === undefined) return `the price of ${asked} is unknown`
      const cost = (bytes / 1_000_000) * price
      if (cost > left + ROUNDING) {
        return `this would go past the confirmed budget (${usd(Math.max(left, 0))} left); plan again`
      }
      left -= cost
      return null
    },
    add(extra) {
      given += extra
      left += extra
    },
    refund(back) {
      left += back
    },
  }
}
