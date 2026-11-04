import { z } from 'zod'
import { EFFECT_MODELS, type EffectModelId } from './effectModels'
import type { EffectRow } from './effects'
import { waitOf, type EffectMakingSummary } from './effectTakes'

/** How many takes one press makes for each effect. */
export const MAKE_ALL_TAKES = 4

/** The body of a request to make takes for these effects (the ones the question listed). */
export const MakeAllBody = z.object({ ids: z.array(z.string().min(1)).max(1000) }).strict()

/** What the press made, as the batch ledger counts it: takes, not effects. */
export interface EffectBatch {
  /** Takes started by the press. */
  total: number
  /** Takes made and on their boards. */
  made: number
  /** Takes stopped before they were made. */
  stopped: number
  /** Takes that could not be made, by effect (a failed take stays until tried again). */
  failed: { id: string; n: number }[]
  /** Takes of the press are still waiting or being made. */
  running: boolean
}

/** The effects of the page, sorted by what a press does with each. */
export interface MakeAllPlan {
  /** No chosen take and not making: they get takes. */
  startable: EffectRow[]
  /** A take is chosen (even one out of date or missing): left out. */
  chosen: EffectRow[]
  /** Already making takes: left out. */
  busy: EffectRow[]
  /** Which takes are chosen is not known: the panel offers nothing. */
  lockUnread: boolean
}

/** Sorts every effect, whatever the list is filtered to. */
export function planMakeAll(
  rows: EffectRow[],
  making: Record<string, EffectMakingSummary>,
): MakeAllPlan {
  const plan: MakeAllPlan = { startable: [], chosen: [], busy: [], lockUnread: false }
  if (rows.some((row) => row.current.kind === 'unknown')) {
    plan.lockUnread = true
    return plan
  }
  for (const row of rows) {
    if (making[row.id]) plan.busy.push(row)
    else if (row.current.kind === 'take') plan.chosen.push(row)
    else plan.startable.push(row)
  }
  return plan
}

/** "1 effect" or "4 effects". */
const effectsOf = (n: number) => `${n} ${n === 1 ? 'effect' : 'effects'}`
/** "1 take" or "16 takes". */
const takesOf = (n: number) => `${n} ${n === 1 ? 'take' : 'takes'}`

/** The panel's line: "4 effects have no chosen take". */
export function makeAllLine(n: number): string {
  return `${effectsOf(n)} ${n === 1 ? 'has' : 'have'} no chosen take`
}

/** The panel's button. */
export function makeAllButton(): string {
  return `Make ${MAKE_ALL_TAKES} takes each`
}

/** The question's heading: "Make 16 takes for 4 effects?". */
export function makeAllHeading(takes: number, effects: number): string {
  return `Make ${takesOf(takes)} for ${effectsOf(effects)}?`
}

/** How long the takes take in all, they being made one after another. */
export function makeAllTime(takes: number, model: EffectModelId): string {
  return `About ${waitOf(Math.max(1, Math.round(takes * EFFECT_MODELS[model].seconds)))} in all`
}

/** The question's model line: the model, and when it is not Setup's, why. */
export function makeAllModelLine(
  main: EffectModelId,
  model: EffectModelId,
  reason: 'absent' | 'partial' | 'failed' | null,
  takes: number,
): string {
  const tail = `${makeAllTime(takes, model)} — they are made one after another, and you can leave the page.`
  if (model === main || !reason) {
    return `Four takes each, on ${EFFECT_MODELS[main].name}, the sound-effects model on Setup. ${tail}`
  }
  const what = {
    absent: "isn't on this computer",
    partial: 'is only partly downloaded',
    failed: 'failed on its last effect',
  }[reason]
  const then = {
    absent: 'how to download it',
    partial: 'how to finish it',
    failed: 'what went wrong',
  }[reason]
  const to = EFFECT_MODELS[model].name
  return `Four takes each, on ${to}. ${EFFECT_MODELS[main].name}, the project's sound-effects model, ${what}, so these takes use ${to}. Setup says ${then}. ${tail}`
}

/** Names as a person lists them: "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The lines saying who is left out of the question, and why; none when nobody is. */
export function leftOutLines(chosen: string[], busy: string[]): string[] {
  const lines: string[] = []
  if (chosen.length) {
    lines.push(
      `${joinNames(chosen)} ${chosen.length === 1 ? 'has' : 'have'} a chosen take and ${chosen.length === 1 ? 'gets' : 'get'} none.`,
    )
  }
  if (busy.length) {
    lines.push(
      `${joinNames(busy)} ${busy.length === 1 ? 'is' : 'are'} already making takes and ${busy.length === 1 ? 'gets' : 'get'} none.`,
    )
  }
  return lines
}

/** The running line: everything being made, hand-started takes included. */
export function runningLine(making: Record<string, EffectMakingSummary>): string {
  const all = Object.values(making)
  const takes = all.reduce((sum, m) => sum + m.takes, 0)
  const left = all.reduce((sum, m) => sum + m.left, 0)
  return `Making ${takesOf(takes)} for ${effectsOf(all.length)} · about ${waitOf(Math.max(1, Math.round(left)))} left`
}

/** What shows when the last take of the press is done: text around the names of effects that failed. */
export interface BatchSummary {
  before: string
  /** Effects with a failed take, once each, in the order they failed; each links to its page. */
  failed: string[]
  after: string
}

/** The summary: how many were made, and what failed or was stopped. */
export function batchSummary(batch: Omit<EffectBatch, 'running'>): BatchSummary {
  const head = `Made ${batch.made} of ${batch.total} takes.`
  const stopped =
    batch.stopped > 0 ? `${batch.stopped} ${batch.stopped === 1 ? 'was' : 'were'} stopped.` : ''
  if (!batch.failed.length)
    return { before: [head, stopped].filter(Boolean).join(' '), failed: [], after: '' }
  const ids = [...new Set(batch.failed.map((f) => f.id))]
  return {
    before: `${head} ${batch.failed.length} could not be made — `,
    failed: ids,
    after: ` ${ids.length === 1 ? 'says' : 'say'} why.${stopped ? ` ${stopped}` : ''}`,
  }
}

/** The line under the panel when the press could not start. */
export const EFFECTS_MAKE_ALL_FAILED =
  'The takes could not be started. Nothing was made; try again.'
