import type { MakingSummary, MakingView } from '../core/musicTake'

/** What a take being made says beside its name: its wait, or about how long is left. */
export function timeLeftText<T extends Pick<MakingView, 'state' | 'elapsed' | 'expected'>>(
  making: T,
): string {
  if (making.state === 'waiting') return 'waiting'
  const left = making.expected - making.elapsed
  if (left <= 0) return 'making · taking longer than usual'
  return `making · about ${Math.ceil(left / 60)} min left`
}

/** How far a take is, 0 to 1: its time over its model's expected time, never complete until it is. */
export function progressOf<T extends Pick<MakingView, 'state' | 'elapsed' | 'expected'>>(
  making: T,
): number {
  if (making.state === 'waiting') return 0
  return Math.min(0.95, making.elapsed / making.expected)
}

/** Why a take failed, with the reassurance that the rest are kept when there are any. */
export function failureLine(message: string, otherTakes: boolean): string {
  return otherTakes ? `${message} Your other takes are kept.` : message
}

/** Whether any take waits or is being made, which the page polls for. */
export function takesAreBeingMade(making: readonly unknown[]): boolean {
  return making.length > 0
}

/** A track's status on its list while takes are made: how many, and about how long is left. */
export function makingStatusText({ takes, left }: MakingSummary): string {
  const minutes = Math.max(1, Math.ceil(left / 60))
  return `making ${takes} ${takes === 1 ? 'take' : 'takes'} · about ${minutes} min`
}
