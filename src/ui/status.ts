import type { StaleReason } from '../core/fingerprint'
import type { LineState, LineStatus } from '../core/planner'

/** How each status looks: its name, and the colour tokens of its dot, pill and bar segment. */
export const STATUS: Record<LineStatus, { label: string; color: string; bg: string }> = {
  ok: { label: 'Up to date', color: 'var(--status-ok)', bg: 'var(--status-ok-bg)' },
  weak: { label: 'Weak', color: 'var(--status-weak)', bg: 'var(--status-weak-bg)' },
  stale: { label: 'Stale', color: 'var(--status-stale)', bg: 'var(--status-stale-bg)' },
  missing: { label: 'Missing', color: 'var(--status-missing)', bg: 'var(--status-missing-bg)' },
  untracked: {
    label: 'Untracked',
    color: 'var(--status-untracked)',
    bg: 'var(--status-untracked-bg)',
  },
  uncast: { label: 'Uncast', color: 'var(--status-uncast)', bg: 'var(--status-uncast-bg)' },
  untranslated: {
    label: 'Not translated',
    color: 'var(--status-untracked)',
    bg: 'var(--status-untracked-bg)',
  },
}

/** Why a clip is stale, as a phrase. */
export const REASON: Record<StaleReason, string> = {
  voice: 'voice changed',
  model: 'model changed',
  cue: 'delivery cue changed',
  text: 'wording changed',
  pronunciation: 'pronunciation changed',
  settings: 'generation settings changed',
}

/** How many stale lines have each reason, most common first. */
export function reasonCounts(lines: LineState[]): [StaleReason, number][] {
  const counts = new Map<StaleReason, number>()
  for (const line of lines) {
    for (const reason of line.reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])
}

/** One line of explanation for a line's status. */
export function statusDetail(line: LineState, minHeard: number): string {
  switch (line.status) {
    case 'stale':
      return line.reasons.map((r) => REASON[r]).join(', ')
    case 'weak':
      return `best take heard ${percent(line.heard)}, below ${percent(minHeard)}`
    case 'missing':
      return 'not recorded yet'
    case 'untracked':
      return 'recorded before Audio Studio; adopt to track it'
    case 'uncast':
      return `${line.speaker} has no voice yet`
    case 'untranslated':
      return ''
    case 'ok':
      // Said while the clip is below the bar; above it (the bar lowered since) it is just ok.
      return line.accepted && line.heard !== null && line.heard < minHeard
        ? `heard ${percent(line.heard)}, accepted`
        : ''
  }
}

/** `0.93` → `93%`; `—` when unknown. */
export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

/** Seconds as `4.2s`; `—` when unknown. */
export function seconds(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}s`
}

/** What a character's lines need, in words: `2 stale · 1 missing`, or `all up to date`. */
export function linesSummary(counts: Partial<Record<LineStatus, number>>): string {
  const parts = (['missing', 'stale', 'weak', 'untracked'] as const)
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${STATUS[s].label.toLowerCase()}`)
  return parts.length ? parts.join(' · ') : 'all up to date'
}

/** How many of a speaker's lines have each status. */
export function speakerCounts(
  lines: LineState[],
  speaker: string,
): Partial<Record<LineStatus, number>> {
  const counts: Partial<Record<LineStatus, number>> = {}
  for (const line of lines)
    if (line.speaker === speaker) counts[line.status] = (counts[line.status] ?? 0) + 1
  return counts
}
