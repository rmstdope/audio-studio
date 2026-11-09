import type { ImageMakingSummary } from '../core/imageTakes'
import { timeText } from '../core/takeTimes'

/**
 * What an image or patch take being made says beside its name: its wait, or about how long is
 * left, rounded up. The model's figure may be a guess; the card never says so.
 */
export function imageTimeLeftText(making: {
  state: 'waiting' | 'making'
  elapsed: number
  expected: number
}): string {
  if (making.state === 'waiting') return 'waiting'
  const left = making.expected - making.elapsed
  if (left <= 0) return 'making · taking longer than expected'
  return `making · about ${timeText(left, 'up')} left`
}

/** An image's status on the act's list while takes are made: how many, and about how long is left. */
export function imageMakingStatusText({
  takes,
  left,
}: Pick<ImageMakingSummary, 'takes' | 'left'>): string {
  return `making ${takes} ${takes === 1 ? 'take' : 'takes'} · about ${timeText(left, 'up')}`
}
