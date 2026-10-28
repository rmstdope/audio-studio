import { elevenModelName } from '../core/elevenSpeech'
import type { ElevenAnswer } from '../core/setup'
import {
  amountProblem,
  cantStart,
  parseAmount,
  parseCredits,
  takesLeft,
  type SittingMoney,
} from '../core/sitting'
import { creditsLeft, usd } from '../core/spend'
import { credits } from './agreed'
import { plural } from './format'

/** An amount with the third decimal a take's price needs ("$0.002"). */
export function usd3(amount: number): string {
  return `$${amount.toFixed(3)}`
}

/** The meter's words: what is used of what the sitting was given, and the takes it still pays for. */
export function meterLine(money: SittingMoney): string {
  return `${usd(money.spent)} of ${usd(money.dollars)} used · about ${plural(money.takesLeft, 'take')} left`
}

/** The used-up bar's words: the money is used, and how many voices wait for a take. */
export function usedUpLine(dollars: number, waiting: number): string {
  const used = `The ${usd(dollars)} for this audition is used.`
  if (waiting === 0) return used
  return `${used} ${waiting === 1 ? '1 voice on the board has' : `${waiting} voices on the board have`} no take yet.`
}

/** The pay button's label: it follows the amount typed; "…" while that is not a sum of money. */
export function payLabel(text: string, more = false): string {
  const amount = parseAmount(text)
  return `Pay up to ${amount === null ? '…' : usd(amount)}${more ? ' more' : ''}`
}

/** What the confirm box shows: waiting for the credit, why it cannot start, or the form. */
export type BoxState =
  | { kind: 'loading' }
  | { kind: 'cant'; message: string }
  | { kind: 'ask'; credit: number; amount: number | null; problem: string | null; canPay: boolean }

/**
 * The box's state for the credit (undefined while it is read, null when it could not be), the
 * audition's cost of a take and the amount typed.
 */
export function boxState(
  credit: number | null | undefined,
  view: { model: string; perTake: number },
  text: string,
): BoxState {
  if (credit === undefined) return { kind: 'loading' }
  const message = cantStart(credit, view.perTake, view.model)
  if (message !== null) return { kind: 'cant', message }
  // `cantStart` has no message only for a credit that was read.
  const known = credit as number
  const problem = amountProblem(text, known)
  return {
    kind: 'ask',
    credit: known,
    amount: parseAmount(text),
    problem,
    canPay: problem === null,
  }
}

/** The points of the box that starts an audition on a paid model. */
export function startPoints(model: string, perTake: number, amount: number): string[] {
  return [
    `Takes are recorded with ${model}, the model the game ships with, and charged to your Fish account.`,
    `A take costs about ${usd3(perTake)}. ${usd(amount)} is enough for about ${plural(takesLeft(amount, perTake), 'voice')}.`,
    'Takes record by themselves until this is used; then the audition asks before spending more.',
  ]
}

/** The points of the box that carries an audition on after a pause. */
export function resumePoints(perTake: number): string[] {
  return [
    'Takes already recorded play without charge.',
    `New takes are charged to your Fish account, about ${usd3(perTake)} each.`,
  ]
}

/**
 * Whether Resume… (the box) stands in for plain Resume: on a paid model, when there is no sitting
 * or its money is used up. With money in the sitting, Resume goes straight to the board.
 */
export function needsResumeBox(
  money: { paid: boolean; sitting: { usedUp: boolean } | null } | null,
): boolean {
  return money !== null && money.paid && (money.sitting === null || money.sitting.usedUp)
}

/**
 * Which cached answer a recorded take is added to: the audition board's for a board take, the
 * cast voice's page answer for the page's. They may be different takes (audition model against
 * the free one), so neither feeds the other; the other is read from the server when needed.
 */
export function takeCaches(board: boolean): { voice: boolean; session: boolean } {
  return { voice: !board, session: board }
}

/** How a take went, for the voices waiting for money. */
export type TakeOutcome = 'recorded' | 'waits' | 'failed'

/** The voices whose take waits for money, after `voice`'s take came out as `outcome`. */
export function waitingAfter(
  waiting: Set<string>,
  voice: string,
  outcome: TakeOutcome,
): Set<string> {
  const next = new Set(waiting)
  if (outcome === 'waits') next.add(voice)
  else next.delete(voice)
  return next
}

/** The credits meter's words: what is used of the credits given, and the takes they still pay for. */
export function creditsMeterLine(money: SittingMoney): string {
  return `${money.spent.toLocaleString('en-US')} of ${credits(money.dollars)} used · about ${plural(money.takesLeft, 'take')} left`
}

/** The used-up credits bar's words: the credits are used, and how many voices wait for a take. */
export function creditsUsedUpLine(given: number, waiting: number): string {
  const used = `The ${credits(given)} for this audition are used.`
  if (waiting === 0) return used
  return `${used} ${waiting === 1 ? '1 voice on the board has' : `${waiting} voices on the board have`} no take yet.`
}

/** The heading of the bar that asks for credits: how many ElevenLabs voices wait for them. */
export function creditsWaitLine(waiting: number): string {
  return waiting === 1
    ? '1 ElevenLabs voice on the board waits for credits'
    : `${waiting} ElevenLabs voices on the board wait for credits`
}

/** The points of the bar that asks for credits. */
export function creditsPoints(model: string, perTake: number): string[] {
  return [
    `A take with ${elevenModelName(model)} is about ${credits(Math.ceil(perTake))}, charged to your plan as it is sent.`,
    'A take already recorded is free; one that fails is given back.',
  ]
}

/** The button that gives credits: it follows the credits typed; "…" while they are not whole credits. */
export function creditsLabel(text: string, more = false): string {
  const given = parseCredits(text)
  return `Use up to ${given === null ? '…' : given.toLocaleString('en-US')}${more ? ' more' : ''} credits`
}

/**
 * What is left on the ElevenLabs plan beside what running recordings and auditions hold (`held`),
 * or why it is unknown (ElevenLabs' answer, or the studio's error); undefined while it is read.
 */
export function planLeftLine(account: ElevenAnswer | Error | undefined, held: number): string {
  if (!account) return 'Reading your plan…'
  if (account instanceof Error) return `What is left on your plan is unknown: ${account.message}`
  if (!account.ok) return `What is left on your plan is unknown: ${account.message}`
  const left = Math.max(creditsLeft(account.account) - held, 0)
  const besides = held ? ', besides what recordings and auditions running now hold' : ''
  return `${credits(left)} left on your plan${besides}`
}
