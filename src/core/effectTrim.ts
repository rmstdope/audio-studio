import type { Trim, TrimRules } from './musicTrim'

/** What a sound effect keeps of its near-silence and the least it bothers to cut: effects are short. */
export const EFFECT_TRIM_RULES: TrimRules = { keep: 0.01, minCut: 0.02 }

/** The line on a trimmed effect take: what went from each end that lost something, in hundredths of a second. */
export function effectCutLine(trim: Trim): string {
  const start = `${trim.start.toFixed(2)} s`
  const end = `${trim.end.toFixed(2)} s`
  if (trim.start > 0 && trim.end > 0) return `${start} cut from the start, ${end} from the end`
  return trim.start > 0 ? `${start} cut from the start` : `${end} cut from the end`
}

/** Whether Trim silence is offered on a take: made to play once, on an effect that plays once. */
export function effectTrimOffered(take: { loops: boolean }, effectLoops: boolean): boolean {
  return !take.loops && !effectLoops
}
