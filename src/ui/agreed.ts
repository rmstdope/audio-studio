import type { ElevenPlan } from '../core/generation'
import type { ElevenAnswer } from '../core/setup'
import { creditsLeft } from '../core/spend'
import { centsUp, dollars } from './format'

/**
 * An amount the user agrees to before a recording spends it: dollars on the Fish account, or
 * credits of the ElevenLabs plan.
 */
export interface Agreed {
  unit: 'usd' | 'credits'
  amount: number
}

/**
 * The amount the server asks to be agreed to, from its answer: a Fish ceiling rounded up to the
 * cent, an ElevenLabs one up to the whole credit, so the amount agreed covers it; null for any
 * other answer.
 */
export function agreedOf(answer: { reason: string; ceiling?: number }): Agreed | null {
  if (answer.ceiling === undefined) return null
  if (answer.reason === 'confirm') return { unit: 'usd', amount: centsUp(answer.ceiling) }
  if (answer.reason === 'confirm-credits') {
    return { unit: 'credits', amount: Math.ceil(answer.ceiling) }
  }
  return null
}

/** ElevenLabs credits, as the page writes them: "1 credit", "27,450 credits". */
export function credits(amount: number): string {
  if (amount === Infinity) return 'credits without limit'
  return `${amount.toLocaleString('en-US')} ${amount === 1 ? 'credit' : 'credits'}`
}

/** The button that agrees to an amount: "Pay up to $0.02", "Use up to 15 credits". */
export function payWords(agreed: Agreed): string {
  return agreed.unit === 'usd'
    ? `Pay up to ${dollars(agreed.amount)}`
    : `Use up to ${credits(agreed.amount)}`
}

/** What a request sends to say the amount was agreed to. */
export function agreedBody(
  agreed: Agreed,
): { confirmedCost: number } | { confirmedCredits: number } {
  return agreed.unit === 'usd'
    ? { confirmedCost: agreed.amount }
    : { confirmedCredits: agreed.amount }
}

/** The button that agrees to a plan's dollars and credits, naming each it pays in. */
export function planPayWords(usd: number, credit: number): string {
  if (!credit) return `Pay up to ${dollars(usd)}`
  if (!usd) return `Use up to ${credits(credit)}`
  return `Pay up to ${dollars(usd)} and ${credits(credit)}`
}

/**
 * The facts of a plan's lines with ElevenLabs voices: the model, the text, the credits they take
 * (one take of each, and at most), and what the plan has left besides what running recordings
 * hold (`held`), or why that is unknown.
 */
export function elevenPlanFacts(
  eleven: ElevenPlan,
  account: ElevenAnswer | undefined,
  held = 0,
): string {
  const taken = `ElevenLabs · ${eleven.model} · ${eleven.characters.toLocaleString('en-US')} characters of text · about ${credits(eleven.credits)}, at most ${credits(eleven.ceiling)}`
  if (!account) return taken
  if (!account.ok) return `${taken} · what is left on your plan is unknown: ${account.message}`
  const left = Math.max(creditsLeft(account.account) - held, 0)
  const besides = held ? ', besides what recordings running now hold' : ''
  return `${taken} · ${left < eleven.ceiling ? 'only ' : ''}${credits(left)} left on your plan${besides}`
}
