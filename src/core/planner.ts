import { clipInputs, fingerprint, staleReasons, type StaleReason } from './fingerprint'
import type { Project } from './project'
import type { Cast, Cues, Line, Lock, Manifest } from './resources'

/**
 * Where a line's clip stands:
 * - `ok`: the clip matches the line and its settings
 * - `weak`: it matches, but its best take was heard below the quality bar
 * - `stale`: it was made from other inputs (`reasons` says which)
 * - `missing`: there is no clip
 * - `untracked`: there is a clip, but nothing says what it was made from (made before the studio)
 * - `uncast`: the speaker has no voice, so nothing can be recorded
 */
export type LineStatus = 'ok' | 'weak' | 'stale' | 'missing' | 'untracked' | 'uncast'

/** Every status, in the order the UI lists them. */
export const LINE_STATUSES: LineStatus[] = ['ok', 'weak', 'stale', 'missing', 'untracked', 'uncast']

/** One line of a part with the state of its clip. */
export interface LineState {
  key: string
  speaker: string
  text: string
  /** The cue the line is (or would be) delivered with. */
  cue: string
  /** Whether that is the line's own cue (from the part's cues), not its character's style. */
  ownCue: boolean
  status: LineStatus
  reasons: StaleReason[]
  heard: number | null
  duration: number | null
  file: string | null
}

/** A clip in the manifest whose line is no longer in the dialog. */
export interface Orphan {
  key: string
  speaker: string | null
  file: string
}

/** The state of every clip in a part. */
export interface PartState {
  lines: LineState[]
  orphans: Orphan[]
  /** Cue keys whose line is no longer in the dialog (its wording changed, so its key did). */
  orphanCues: string[]
  counts: Record<LineStatus, number>
}

/** What the planner reads about a part. */
export interface PlanInput {
  lines: Line[]
  cast: Cast
  cues: Cues
  lock: Lock
  manifest: Manifest
  /** File names present in the part's clips folder. */
  files: Set<string>
  narration: Project['narration']
}

/** The state of every line's clip in a part, its orphaned clips and cues, and counts per status. */
export function planPart(input: PlanInput): PartState {
  const { lines, cast, cues, lock, manifest, files, narration } = input
  const counts = Object.fromEntries(LINE_STATUSES.map((s) => [s, 0])) as Record<LineStatus, number>

  const states = lines.map((line): LineState => {
    const character = cast.speakers[line.speaker]
    const inputs = clipInputs(line, character, cues, cast.pronounce, narration)
    const clip = manifest[line.key]
    const file = clip && files.has(clip.file) ? clip.file : null
    const entry = lock[line.key]
    let status: LineStatus
    let reasons: StaleReason[] = []
    if (!inputs) status = 'uncast'
    else if (!file) status = 'missing'
    else if (!entry) status = 'untracked'
    else if (entry.fp !== fingerprint(inputs).fp) {
      status = 'stale'
      reasons = staleReasons(entry, inputs)
    } else if (entry.heard !== undefined && entry.heard < narration.quality.minHeard)
      status = 'weak'
    else status = 'ok'
    counts[status]++
    return {
      key: line.key,
      speaker: line.speaker,
      text: line.text,
      cue: inputs?.cue ?? cues[line.key] ?? character?.style ?? '',
      ownCue: line.key in cues,
      status,
      reasons,
      heard: file ? (entry?.heard ?? null) : null,
      duration: file ? (clip?.duration ?? null) : null,
      file,
    }
  })

  const keys = new Set(lines.map((line) => line.key))
  const orphans = Object.entries(manifest)
    .filter(([key]) => !keys.has(key))
    .map(([key, clip]) => ({ key, speaker: clip.speaker ?? null, file: clip.file }))
    .sort((a, b) => a.key.localeCompare(b.key))
  const orphanCues = Object.keys(cues)
    .filter((key) => !keys.has(key))
    .sort()

  return { lines: states, orphans, orphanCues, counts }
}

/**
 * The lock with every untracked clip taken as made from today's inputs, so clips recorded before
 * the studio are not re-recorded just because nothing says what they were made from.
 */
export function adoptUntracked(input: PlanInput, now: string): { lock: Lock; adopted: number } {
  const { lines, cast, cues, narration } = input
  const untracked = new Set(
    planPart(input)
      .lines.filter((line) => line.status === 'untracked')
      .map((line) => line.key),
  )
  const lock: Lock = { ...input.lock }
  for (const line of lines) {
    if (!untracked.has(line.key)) continue
    // An untracked line has a voice, so it has inputs.
    const inputs = clipInputs(line, cast.speakers[line.speaker], cues, cast.pronounce, narration)!
    const { fp, parts } = fingerprint(inputs)
    lock[line.key] = { fp, voice: inputs.voice, model: inputs.model, parts, adopted: true, at: now }
  }
  return { lock, adopted: untracked.size }
}
