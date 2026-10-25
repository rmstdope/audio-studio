import { priceOf } from './prices'
import { usd } from './spend'

/** Below this, a difference in dollars is rounding, not money. */
const ROUNDING = 1e-9

/** How many takes the suggested amount is meant to cover (about 50 voices). */
const SUGGESTED_TAKES = 50

/** What one take of `bytes` of text costs on `model` at `at`; null when the model's price is unknown. */
export function perTakeCost(model: string, bytes: number, at: Date): number | null {
  const price = priceOf(model, at)
  return price === undefined ? null : (bytes / 1_000_000) * price
}

/** The amount to suggest for a sitting: about 50 takes, rounded up to the next five cents (at least five). */
export function suggestedAmount(perTake: number): number {
  const nickels = Math.max(1, Math.ceil((SUGGESTED_TAKES * perTake) / 0.05 - ROUNDING))
  return Number((nickels * 0.05).toFixed(2))
}

/** How many whole takes `dollars` pay for (an amount in the box, or what is left in a sitting). */
export function takesLeft(dollars: number, perTake: number): number {
  return perTake > 0 ? Math.max(0, Math.floor(dollars / perTake + ROUNDING)) : 0
}

/** An amount of dollars as typed: whole cents, more than nothing; null for anything else. */
export function parseAmount(text: string): number | null {
  const match = /^\$?\s*(\d+(?:\.\d{0,2})?|\.\d{1,2})$/.exec(text.trim())
  const amount = match ? Number(match[1]) : NaN
  return amount > 0 ? amount : null
}

/** Why the amount typed cannot be paid (a line for the box), or null when it can. */
export function amountProblem(text: string, credit: number): string | null {
  const amount = parseAmount(text)
  if (amount === null) return 'Enter an amount in dollars, like 0.10.'
  if (amount > credit + ROUNDING) return `That is more than your credit of ${usd(credit)}.`
  return null
}

/**
 * Why an audition on `model` cannot start at all ("The audition can't start"): the credit could
 * not be read (null), or is not enough for one take. Null when it can.
 */
export function cantStart(credit: number | null, perTake: number, model: string): string | null {
  if (credit === null) {
    return `The studio couldn’t read your Fish credit, so it can’t tell whether ${model} takes are covered. Check the Fish key on Setup and try again.`
  }
  if (credit + ROUNDING < perTake) {
    return `Your Fish credit is ${usd(credit)}, not enough for a take with ${model}. Add credit on Fish, or set the audition model to the free one.`
  }
  return null
}

/** The money of a sitting, as the page shows it. */
export interface SittingMoney {
  /** Dollars the sitting was given (a top-up included). */
  dollars: number
  /** Dollars spent in it so far. */
  spent: number
  /** Dollars left. */
  left: number
  /** About how many takes the money left pays for. */
  takesLeft: number
  /** Whether what is left cannot pay for one more take. */
  usedUp: boolean
}

/** What the page needs to know about the money of a character's audition. */
export interface SittingView {
  /** The project's audition model. */
  model: string
  /** Whether takes on it are charged. */
  paid: boolean
  /** What a take of the audition phrase costs; 0 on a free model. */
  perTake: number
  /** The amount to suggest in the box. */
  suggested: number
  /** Dollars charged to this audition over all its sittings; 0 without one. */
  spentBefore: number
  /** The sitting going on, or null (none yet, or paused, stopped or cast since). */
  sitting: SittingMoney | null
}

/** The money of a sitting that was given `dollars` and has `left` of it, for takes of `perTake`. */
export function sittingMoney(dollars: number, left: number, perTake: number): SittingMoney {
  const remaining = Math.max(left, 0)
  return {
    dollars,
    spent: Math.max(dollars - remaining, 0),
    left: remaining,
    takesLeft: takesLeft(remaining, perTake),
    usedUp: remaining + ROUNDING < perTake,
  }
}
