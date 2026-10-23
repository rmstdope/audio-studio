import type { StaleReason } from './fingerprint'
import type { LineState, Orphan } from './planner'

/** US dollars per million UTF-8 bytes of text sent, per Fish model (as RetroQuest's fish_tts.py lists). */
export const PRICE_PER_MILLION_BYTES: Record<string, number> = {
  's2.1-pro-free': 0,
  's2.1-pro': 15,
  's2-pro': 15,
  'drama-3': 50,
}

/** What generating a part (or one character in it) would do. */
export interface GenerationPlan {
  /** The lines to record, in dialog order: the missing and the stale ones (and the weak, if asked). */
  keys: string[]
  /** Weak lines in scope: recorded but heard below the bar; retaken only when asked. */
  weak: string[]
  /** Up-to-date clips in scope never checked by Whisper (recorded before the studio, or unchecked). */
  unmeasured: string[]
  missing: number
  /** Stale lines by the reasons they are stale (a line can count under several). */
  stale: Partial<Record<StaleReason, number>>
  /** Speakers in scope with lines but no voice: their lines cannot be recorded. */
  uncast: string[]
  /** Orphaned clips in scope (their line left the dialog), removed if the user agrees. */
  orphans: string[]
  /** UTF-8 bytes of text sent to Fish (cues included), which paid models charge for. */
  bytes: number
  model: string
  /** Estimated cost in US dollars, for one take of each line; 0 on the free model; null for a
   * model whose price is unknown. */
  cost: number | null
  /** Takes a line may need at most (when a take is not heard well enough). */
  takes: number
  /** Whether takes are checked with Whisper. */
  checked: boolean
}

const encoder = new TextEncoder()

/**
 * What generating would do, for the whole part or one speaker in it: record every missing and
 * stale line (and the weak ones, if asked), and offer to remove the orphans. Also lists the clips
 * that could be measured with Whisper without new audio.
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
  },
): GenerationPlan {
  const inScope = (who: string | null) => !speaker || who === speaker
  const lines = state.lines.filter((line) => inScope(line.speaker))
  const recordable = new Set(['missing', 'stale', ...(includeWeak ? ['weak'] : [])])
  const toRecord = lines.filter((line) => recordable.has(line.status))
  const stale: Partial<Record<StaleReason, number>> = {}
  for (const line of toRecord) {
    for (const reason of line.reasons) stale[reason] = (stale[reason] ?? 0) + 1
  }
  const bytes = toRecord.reduce(
    (sum, line) => sum + sent(line).reduce((s, text) => s + encoder.encode(text).length, 0),
    0,
  )
  const price = PRICE_PER_MILLION_BYTES[model]
  return {
    keys: toRecord.map((line) => line.key),
    weak: lines.filter((line) => line.status === 'weak').map((line) => line.key),
    unmeasured: lines
      .filter((line) => line.status === 'ok' && line.file && line.heard === null)
      .map((line) => line.key),
    missing: toRecord.filter((line) => line.status === 'missing').length,
    stale,
    uncast: [...new Set(lines.filter((l) => l.status === 'uncast').map((l) => l.speaker))],
    orphans: state.orphans.filter((o) => inScope(o.speaker)).map((o) => o.key),
    bytes,
    model,
    cost: price === undefined ? null : (bytes / 1_000_000) * price,
    takes,
    checked,
  }
}
