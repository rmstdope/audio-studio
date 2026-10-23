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
  /** The lines to record, in dialog order: the missing and the stale ones. */
  keys: string[]
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
  /** Estimated cost in US dollars; 0 on the free model. */
  cost: number
}

const encoder = new TextEncoder()

/**
 * What generating would do, for the whole part or one speaker in it: record every missing and
 * stale line (weak lines wait for the quality check, step 5), and offer to remove the orphans.
 */
export function planGeneration(
  state: { lines: LineState[]; orphans: Orphan[] },
  { model, speaker }: { model: string; speaker?: string },
): GenerationPlan {
  const inScope = (who: string | null) => !speaker || who === speaker
  const lines = state.lines.filter((line) => inScope(line.speaker))
  const toRecord = lines.filter((line) => line.status === 'missing' || line.status === 'stale')
  const stale: Partial<Record<StaleReason, number>> = {}
  for (const line of toRecord) {
    for (const reason of line.reasons) stale[reason] = (stale[reason] ?? 0) + 1
  }
  const bytes = toRecord.reduce(
    (sum, line) => sum + encoder.encode(line.cue ? `${line.cue} ${line.text}` : line.text).length,
    0,
  )
  return {
    keys: toRecord.map((line) => line.key),
    missing: toRecord.filter((line) => line.status === 'missing').length,
    stale,
    uncast: [...new Set(lines.filter((l) => l.status === 'uncast').map((l) => l.speaker))],
    orphans: state.orphans.filter((o) => inScope(o.speaker)).map((o) => o.key),
    bytes,
    model,
    cost: (bytes / 1_000_000) * (PRICE_PER_MILLION_BYTES[model] ?? 0),
  }
}
