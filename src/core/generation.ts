import type { StaleReason } from './fingerprint'
import type { LineState, Orphan } from './planner'
import { priceOf } from './prices'

/** What generating a part (or one character in it) would do. */
export interface GenerationPlan {
  /** The lines to record, in dialog order: the missing and the stale ones (and the weak, if asked). */
  keys: string[]
  /** Weak lines in scope: recorded but heard below the bar; retaken only when asked. */
  weak: string[]
  /**
   * Up-to-date clips in scope never checked by Whisper (recorded before the studio, or unchecked);
   * none when takes are not checked.
   */
  unmeasured: string[]
  /**
   * Weak lines in scope, final or not, Whisper can check again without new audio (Check again);
   * none when takes are not checked.
   */
  recheck: string[]
  /** In a final plan: clips up to date with the draft model, recorded again with the final one. */
  drafted: number
  /** Clips the studio has no record of (made before it), recorded again in a final plan. */
  untracked: number
  missing: number
  /** Stale lines by the reasons they are stale (a line can count under several). */
  stale: Partial<Record<StaleReason, number>>
  /** Speakers in scope with lines but no voice: their lines cannot be recorded. */
  uncast: string[]
  /** Lines in scope with no text in this language: never recorded. */
  untranslated: number
  /** Orphaned clips in scope (their line left the dialog), removed if the user agrees. */
  orphans: string[]
  /** UTF-8 bytes of text sent to Fish (cues included), which paid models charge for. */
  bytes: number
  model: string
  /** Estimated cost in US dollars, for one take of each line; 0 on the free model; null for a
   * model whose price is unknown. */
  cost: number | null
  /** The most the plan can cost: every line needing every take (null for an unknown price). */
  ceiling: number | null
  /** Takes a line may need at most (when a take is not heard well enough). */
  takes: number
  /** Whether this is the final recording (every line not final yet, with the final model). */
  final: boolean
  /** Whether takes are checked with Whisper. */
  checked: boolean
}

const encoder = new TextEncoder()

/**
 * What generating would do, for the whole part or one speaker in it: record every missing and
 * stale line (and the weak ones, if asked), and offer to remove the orphans. Also lists the clips
 * that could be measured with Whisper without new audio, and the weak lines it could check again.
 */
export function planGeneration(
  state: { lines: LineState[]; orphans: Orphan[] },
  {
    model,
    speaker,
    sent = (line) => [line.cue ? `${line.cue} ${line.text}` : line.text],
    takes = 1,
    checked = false,
    includeWeak = false,
    final = false,
    at,
  }: {
    model: string
    speaker?: string
    /** The texts sent to Fish for a line (its pieces, with cue and pronunciations). */
    sent?: (line: LineState) => string[]
    /** Takes a line may need at most. */
    takes?: number
    /** Whether takes are checked with Whisper. */
    checked?: boolean
    /** Retake the weak lines too. */
    includeWeak?: boolean
    /**
     * The final recording: every cast, translated line whose clip is not final yet, with `model` (the final
     * one), whatever its status.
     */
    final?: boolean
    /** When the plan is priced: prices change, promotions end. */
    at: Date
  },
): GenerationPlan {
  const inScope = (who: string | null) => !speaker || who === speaker
  const lines = state.lines.filter((line) => inScope(line.speaker))
  const recordable = new Set(['missing', 'stale', ...(includeWeak ? ['weak'] : [])])
  const toRecord = lines.filter((line) =>
    final
      ? // Everything recordable not final yet; a weak final clip only when asked.
        line.status !== 'uncast' &&
        line.status !== 'untranslated' &&
        (!line.final || (includeWeak && line.status === 'weak'))
      : // A final clip is never taken back to the draft model by a retake.
        recordable.has(line.status) && !(line.final && line.status === 'weak'),
  )
  const stale: Partial<Record<StaleReason, number>> = {}
  for (const line of toRecord) {
    for (const reason of line.reasons) stale[reason] = (stale[reason] ?? 0) + 1
  }
  const bytes = toRecord.reduce(
    (sum, line) => sum + sent(line).reduce((s, text) => s + encoder.encode(text).length, 0),
    0,
  )
  const price = priceOf(model, at)
  return {
    keys: toRecord.map((line) => line.key),
    // The weak lines a retake would add: not final ones in a draft plan (never taken back to the
    // draft model), only final ones in a final plan (the others are in it anyway).
    weak: lines
      .filter((line) => line.status === 'weak' && line.final === final)
      .map((line) => line.key),
    unmeasured: checked
      ? lines
          .filter((line) => line.status === 'ok' && line.file && line.heard === null)
          .map((line) => line.key)
      : [],
    recheck: checked ? lines.filter((line) => line.status === 'weak').map((line) => line.key) : [],
    missing: toRecord.filter((line) => line.status === 'missing').length,
    drafted: final
      ? toRecord.filter((line) => !line.final && (line.status === 'ok' || line.status === 'weak'))
          .length
      : 0,
    untracked: toRecord.filter((line) => line.status === 'untracked').length,
    stale,
    uncast: [...new Set(lines.filter((l) => l.status === 'uncast').map((l) => l.speaker))],
    untranslated: lines.filter((l) => l.status === 'untranslated').length,
    orphans: state.orphans.filter((o) => inScope(o.speaker)).map((o) => o.key),
    bytes,
    model,
    cost: price === undefined ? null : (bytes / 1_000_000) * price,
    ceiling: costCeiling(
      { lines: toRecord },
      toRecord.map((line) => line.key),
      { model, sent, takes, at },
    ),
    takes,
    checked,
    final,
  }
}

/**
 * The most recording `keys` can cost in dollars: the bytes sent for those lines at the model's
 * price at `at`, times every take; null for a model whose price is unknown.
 */
export function costCeiling(
  state: { lines: LineState[] },
  keys: string[],
  {
    model,
    sent = (line) => [line.cue ? `${line.cue} ${line.text}` : line.text],
    takes = 1,
    at,
  }: { model: string; sent?: (line: LineState) => string[]; takes?: number; at: Date },
): number | null {
  const price = priceOf(model, at)
  if (price === undefined) return null
  const wanted = new Set(keys)
  const bytes = state.lines
    .filter((line) => wanted.has(line.key))
    .reduce(
      (sum, line) => sum + sent(line).reduce((s, text) => s + encoder.encode(text).length, 0),
      0,
    )
  return (bytes / 1_000_000) * price * takes
}
