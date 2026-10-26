import { priceDetail, pricedModels } from './prices'
import { RETIRED_MODEL, sameModel } from './retirement'
import { usd } from './spend'

/** The three stages that each use a Fish model. */
export type Stage = 'audition' | 'draft' | 'final'

/** The stages' models, as the project file names them. */
export type StageModels = Record<Stage, string>

/** The stages in the order the panel shows them, each with its name and what it is for. */
export const STAGES: readonly { stage: Stage; name: string; purpose: string }[] = [
  {
    stage: 'audition',
    name: 'Audition',
    purpose: 'Takes of voices you are trying for a character.',
  },
  {
    stage: 'draft',
    name: 'Draft',
    purpose: 'Every line, recorded while the game is being written.',
  },
  { stage: 'final', name: 'Final', purpose: 'Every line again, for the game you ship.' },
]

/** The line under Final when it names the same model as Draft. */
export const SAME_AS_DRAFT =
  'Same as draft: every line is recorded once, with no separate final recording.'

/** What the project's recorded clips were made with: lines and bytes sent, by model. */
export type Recorded = Record<string, { lines: number; bytes: number }>

/** The project's whole dialog: every line in every language, and the bytes sent to say them. */
export interface Dialog {
  lines: number
  bytes: number
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** A day as "12 November" (UTC, as the prices' dates are kept), or "12 Nov" when short. */
function day(date: Date, short = false): string {
  const month = MONTHS[date.getUTCMonth()]!
  return `${date.getUTCDate()} ${short ? month.slice(0, 3) : month}`
}

/** An amount in dollars, to the cent; a fraction of a cent above nothing says so. */
function money(amount: number): string {
  return amount > 0 && amount < 0.005 ? 'under $0.01' : usd(amount)
}

/** An amount after "about": a fraction of a cent reads "under $0.01", not "about under $0.01". */
function about(amount: number): string {
  return amount > 0 && amount < 0.005 ? money(amount) : `about ${money(amount)}`
}

/** A rate in dollars per million characters: whole dollars without cents. */
function rate(price: number): string {
  return Number.isInteger(price) ? `$${price}` : usd(price)
}

/** A model's price in short, for its menu entry. */
export function menuLabel(model: string, at: Date): string {
  const detail = priceDetail(model, at)
  if (!detail) return 'price unknown'
  if (model === RETIRED_MODEL) return `${rate(detail.price)} · retires 31 December`
  if (detail.price === 0) return 'Free'
  if (detail.promotion) {
    return `${rate(detail.promotion.price)} until ${day(detail.promotion.until, true)}`
  }
  return rate(detail.price)
}

/** One entry of a stage's menu. */
export interface ModelOption {
  model: string
  label: string
  /** Set apart at the bottom of the menu: the model that is going away. */
  apart: boolean
}

/**
 * What a stage's menu offers: every model the studio has a price for except s1, which only a
 * stage still on it offers (last, set apart). A model named by hand that the studio has no price
 * for is listed first, so the menu shows what the file says.
 */
export function modelOptions(_stage: Stage, current: string, at: Date): ModelOption[] {
  const priced = pricedModels()
  const options: ModelOption[] = priced
    .filter((model) => model !== RETIRED_MODEL)
    .map((model) => ({ model, label: menuLabel(model, at), apart: false }))
  if (!priced.includes(current)) {
    options.unshift({ model: current, label: menuLabel(current, at), apart: false })
  }
  if (current === RETIRED_MODEL) {
    options.push({ model: current, label: menuLabel(current, at), apart: true })
  }
  return options
}

/** Fish's rate, then what recording the whole dialog once would cost with the model. */
export function priceWords(model: string, at: Date, dialog: Dialog): string {
  const detail = priceDetail(model, at)
  if (!detail) return 'The studio has no price for this model.'
  if (detail.price === 0) return 'Free'
  const per = 'per million characters'
  const parts: string[] = []
  const { promotion } = detail
  parts.push(
    promotion
      ? `${rate(promotion.price)} ${per} until ${day(promotion.until)}, then ${rate(detail.price)}`
      : `${rate(detail.price)} ${per}`,
  )
  if (model === RETIRED_MODEL) parts.push('retires 31 December')
  if (dialog.lines > 0) {
    const total = (price: number) => money((dialog.bytes / 1_000_000) * price)
    const count = `${dialog.lines.toLocaleString('en-US')} line${dialog.lines === 1 ? '' : 's'}`
    parts.push(
      promotion
        ? `about ${total(promotion.price)} for all ${count} (${total(detail.price)} from ${day(promotion.until)})`
        : `about ${total(detail.price)} for all ${count}`,
    )
  }
  return parts.join(' · ')
}

/** What recording again costs: now, and when a promotion ends, at the list price. */
export interface Cost {
  now: number
  later: number | null
}

/** What choosing a model does: nothing, a save at once, or a question first. */
export type Change =
  { kind: 'none' } | { kind: 'save' } | { kind: 'ask'; lines: number; cost: Cost }

/** Whether a clip made with `made` is in date for the stage models (a final one only if separate). */
function inUse(made: string, models: StageModels): boolean {
  return (
    sameModel(made, models.draft) ||
    (models.final !== models.draft && sameModel(made, models.final))
  )
}

/**
 * What choosing `to` for `stage` does. The audition model always saves at once. A draft or final
 * change saves at once unless recorded lines are made with a model that is in date now and would
 * not be after it: then it asks, with how many and what recording them again costs. s1 and
 * s2.1-pro count as one model.
 */
export function changeOf(
  stage: Stage,
  to: string,
  models: StageModels,
  recorded: Recorded,
  at: Date,
): Change {
  if (to === models[stage]) return { kind: 'none' }
  if (stage === 'audition') return { kind: 'save' }
  const after = { ...models, [stage]: to }
  let lines = 0
  let bytes = 0
  for (const [made, got] of Object.entries(recorded)) {
    if (inUse(made, models) && !inUse(made, after)) {
      lines += got.lines
      bytes += got.bytes
    }
  }
  if (lines === 0) return { kind: 'save' }
  const detail = priceDetail(to, at)
  const dollars = (price: number) => (bytes / 1_000_000) * price
  const cost: Cost = detail
    ? {
        now: dollars(detail.promotion?.price ?? detail.price),
        later: detail.promotion ? dollars(detail.price) : null,
      }
    : { now: 0, later: null }
  return { kind: 'ask', lines, cost }
}

/** The question before a change that makes recorded lines out of date. */
export interface Question {
  heading: string
  items: string[]
  keep: string
  confirm: string
}

/** The words of the question for a draft or final change. */
export function questionWords(
  stage: 'draft' | 'final',
  from: string,
  to: string,
  change: { lines: number; cost: Cost },
  file: string,
  at: Date,
): Question {
  const { lines, cost } = change
  const until = priceDetail(to, at)?.promotion?.until
  const again =
    cost.now === 0
      ? 'free'
      : cost.later !== null && until
        ? `${about(cost.now)} (${about(cost.later)} from ${day(until)})`
        : about(cost.now)
  const one = lines === 1
  const count = `${lines.toLocaleString('en-US')} line${one ? '' : 's'}`
  const become = one ? 'becomes' : 'become'
  const them = one ? 'it' : 'them'
  const draft = stage === 'draft'
  const made = draft ? `drafted with ${from}` : `recorded for the final with ${from}`
  const next = draft ? 'the next draft' : 'the next final recording'
  return {
    heading: draft ? `Switch drafts to ${to}?` : `Switch the final recording to ${to}?`,
    items: [
      `${draft ? 'Draft' : 'Final'}: ${from} → ${to}`,
      `${count} ${made} ${become} out of date: ${next} records ${them} again, ${again}.`,
      `Saved in ${file}; nothing else in it changes.`,
    ],
    keep: `Keep ${from}`,
    confirm: `Switch to ${to}`,
  }
}

/** The heading of the box that says a switch was not saved. */
export function failureHeading(stage: Stage, to: string): string {
  const what =
    stage === 'draft' ? 'drafts' : stage === 'final' ? 'the final recording' : 'auditions'
  return `Could not switch ${what} to ${to}`
}

/** What is going on that stops the menus: a part recording, or a character auditioning. */
export type Busy = { kind: 'recording' | 'auditioning'; name: string }

/** The line at the top of the panel naming what is going on. */
export function busyWords(busy: Busy): string {
  return `${busy.name} is ${busy.kind}. The models can be changed when it ends.`
}
