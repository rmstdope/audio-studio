import { spokenPieces } from './spoken'
import type { StaleReason } from './fingerprint'
import type { LineState, Orphan } from './planner'
import { elevenCredits } from './elevenSpeech'
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
  /** The Fish model the plan records with. */
  model: string
  /**
   * Estimated cost of the Fish lines in US dollars, for one take of each line; 0 on the free
   * model; null for a model whose price is unknown.
   */
  cost: number | null
  /** The most the Fish lines can cost: every line needing every take (null for an unknown price). */
  ceiling: number | null
  /** The lines recorded by ElevenLabs voices and what they take of the plan, or null for none. */
  eleven: ElevenPlan | null
  /** Takes a line may need at most (when a take is not heard well enough). */
  takes: number
  /** Whether this is the final recording (every line not final yet, with the final model). */
  final: boolean
  /** Whether takes are checked with Whisper. */
  checked: boolean
}

/** What the lines with ElevenLabs voices in a plan take, in ElevenLabs credits. */
export interface ElevenPlan {
  keys: string[]
  /** The ElevenLabs model they are recorded with. */
  model: string
  /** Characters of text sent to ElevenLabs (cues included). */
  characters: number
  /** The credits one take of each line takes. */
  credits: number
  /** The most credits they can take: every line needing every take. */
  ceiling: number
}

/**
 * The ElevenLabs model a line is spoken with, when its voice is an ElevenLabs one; null for a
 * Fish voice, whose lines go with the plan's own model.
 */
export type ElevenModelOf = (line: LineState) => string | null

const encoder = new TextEncoder()

/** The credits one take of `line` takes on `model`: the characters of each piece sent. */
function lineCredits(line: LineState, model: string, sent: (line: LineState) => string[]): number {
  return sent(line).reduce((sum, text) => sum + (elevenCredits(model, text) ?? 0), 0)
}

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
    sent = (line) => spokenPieces(line.text, line.cue, {}, Infinity, line.inside),
    takes = 1,
    checked = false,
    includeWeak = false,
    final = false,
    elevenModelOf = () => null,
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
    /** Which lines ElevenLabs speaks, and with which model; by default none. */
    elevenModelOf?: ElevenModelOf
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
  const byFish = toRecord.filter((line) => elevenModelOf(line) === null)
  const byEleven = toRecord.filter((line) => elevenModelOf(line) !== null)
  const bytes = byFish.reduce(
    (sum, line) => sum + sent(line).reduce((s, text) => s + encoder.encode(text).length, 0),
    0,
  )
  const price = priceOf(model, at)
  const credits = byEleven.reduce(
    (sum, line) => sum + lineCredits(line, elevenModelOf(line)!, sent),
    0,
  )
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
      { lines: byFish },
      byFish.map((line) => line.key),
      { model, sent, takes, at },
    ),
    eleven: byEleven.length
      ? {
          keys: byEleven.map((line) => line.key),
          model: elevenModelOf(byEleven[0]!)!,
          characters: byEleven.reduce(
            (sum, line) => sum + sent(line).reduce((s, text) => s + [...text].length, 0),
            0,
          ),
          credits,
          ceiling: credits * takes,
        }
      : null,
    takes,
    checked,
    final,
  }
}

/**
 * The most recording `keys` can cost in dollars: the bytes sent for those lines at the model's
 * price at `at`, times every take; null for a model whose price is unknown. Lines ElevenLabs
 * speaks (`elevenModelOf`) cost credits instead, so they are not counted here (`creditCeiling`).
 */
export function costCeiling(
  state: { lines: LineState[] },
  keys: string[],
  {
    model,
    sent = (line) => spokenPieces(line.text, line.cue, {}, Infinity, line.inside),
    takes = 1,
    elevenModelOf = () => null,
    at,
  }: {
    model: string
    sent?: (line: LineState) => string[]
    takes?: number
    elevenModelOf?: ElevenModelOf
    at: Date
  },
): number | null {
  const wanted = new Set(keys)
  const lines = state.lines.filter((line) => wanted.has(line.key) && elevenModelOf(line) === null)
  const price = priceOf(model, at)
  if (price === undefined) return lines.length ? null : 0
  const bytes = lines.reduce(
    (sum, line) => sum + sent(line).reduce((s, text) => s + encoder.encode(text).length, 0),
    0,
  )
  return (bytes / 1_000_000) * price * takes
}

/**
 * The most credits recording `keys` can take: each line ElevenLabs speaks (`elevenModelOf`), its
 * characters sent at its model's credits, times every take. Fish's lines take none.
 */
export function creditCeiling(
  state: { lines: LineState[] },
  keys: string[],
  {
    elevenModelOf,
    sent = (line) => spokenPieces(line.text, line.cue, {}, Infinity, line.inside),
    takes = 1,
  }: { elevenModelOf: ElevenModelOf; sent?: (line: LineState) => string[]; takes?: number },
): number {
  const wanted = new Set(keys)
  return (
    state.lines
      .filter((line) => wanted.has(line.key))
      .reduce((sum, line) => {
        const model = elevenModelOf(line)
        return model === null ? sum : sum + lineCredits(line, model, sent)
      }, 0) * takes
  )
}
