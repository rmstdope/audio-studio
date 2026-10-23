import type { StaleReason } from '../core/fingerprint'
import type { LineState, LineStatus } from '../core/planner'

/** How each status looks: its name, and the colour of its dot, pill and bar segment. */
export const STATUS: Record<LineStatus, { label: string; color: string; bg: string }> = {
  ok: { label: 'Up to date', color: '#3ddc97', bg: '#10291f' },
  weak: { label: 'Weak', color: '#ff94a8', bg: '#2e1720' },
  stale: { label: 'Stale', color: '#ffc24b', bg: '#2d2412' },
  missing: { label: 'Missing', color: '#8fb5ff', bg: '#142033' },
  untracked: { label: 'Untracked', color: '#b8bfcc', bg: '#1d2029' },
  uncast: { label: 'Uncast', color: '#ff9a6b', bg: '#2a1b12' },
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
export function statusDetail(line: LineState, minHeard = 0.9): string {
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
    case 'ok':
      return ''
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
