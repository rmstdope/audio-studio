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

/** The reason when a change is on its way to the studio and the control waits for the answer. */
export const WAIT_FOR_CHANGE = 'Wait for the current change to finish.'

/** Why the music lock being unreadable keeps the choosing, dropping, moving, trimming and fading off. */
export const MUSIC_LOCK_UNREAD =
  'The music lock cannot be read, so choosing, dropping, moving, trimming and fading wait. Fix the lock file, then reload.'

/** Why a track's model and take count menus are off, the first to wait for; null when neither. */
export function makeWaitWhy(now: { making: boolean; savingBrief: boolean }): string | null {
  if (now.making)
    return 'Takes are being made for this track. Change this when they are done, or Stop.'
  if (now.savingBrief) return 'The brief is being saved. This turns on when it is.'
  return null
}

/**
 * Why a track's Make button is off, the first to deal with: what Setup fixes (`generator` is the
 * generator's message), the model for this track (too long, or not here), then the waiting.
 */
export function musicMakeWhy(now: {
  generator: string | null
  tooLong: string | null
  missing: string | null
  pending: boolean
  making: boolean
  savingBrief: boolean
}): string | null {
  if (now.generator) return `${now.generator} Setup says what is missing.`
  if (now.tooLong) return now.tooLong
  if (now.missing) return now.missing
  if (now.making)
    return 'Takes are being made for this track. Make more when they are done, or Stop.'
  if (now.savingBrief) return 'The brief is being saved. Make turns on when it is.'
  if (now.pending) return WAIT_FOR_CHANGE
  return null
}

/** Why Fades… waits: another take's fades are open. */
export function closeFadesFirst(fading: number | null): string {
  return `Close the fades of Take ${fading} first.`
}

/** Why Trim silence waits while a trim is under way. */
export const WAIT_FOR_TRIM = 'Wait for the trim to finish.'

/** Why Trim silence is greyed when the take gives no other reason: there is nothing it could cut. */
export const NOT_TRIMMABLE_WHY = 'There is no silence at the ends of this take to trim.'
