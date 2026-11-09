import type { OtherModelReason } from '../core/imagesMakeAll'
import { timeText } from '../core/takeTimes'
import { joined } from './imagesText'

const images = (n: number) => `${n} ${n === 1 ? 'image' : 'images'}`

/** The panel's line: how many images one press would make takes for. */
export function readyLine(n: number): string {
  return `${images(n)} ${n === 1 ? 'has' : 'have'} no chosen take`
}

/** The question's heading: "Make 12 takes for 3 images?". */
export function makeAllHeading(takes: number, imageCount: number): string {
  return `Make ${takes} takes for ${images(imageCount)}?`
}

/** Why Setup's model is not used, as the end of the question's first sentence. */
const WHY: Record<OtherModelReason, string> = {
  absent: "isn't on this computer",
  partial: 'is only partly downloaded',
  failed: 'failed on its last take',
}

/**
 * The question's line: the model the takes are made on (`why` says why it is not Setup's model
 * `main`, when it is not) and about how long they take in all.
 */
export function makeAllLine({
  model,
  main,
  why,
  seconds,
  guess,
}: {
  model: string
  main: string
  why: OtherModelReason | null
  seconds: number
  /** Whether the time is still only a guess, the model having timed no take here. */
  guess: boolean
}): string {
  const lead = why
    ? `Four takes each, on ${model}: ${main}, the image model on Setup, ${WHY[why]}.`
    : `Four takes each, on ${model}, the image model on Setup.`
  const time = `${timeText(seconds, 'up')} in all`
  return `${lead} ${guess ? `A guess: about ${time}` : `About ${time}`} — they are made one after another, and you can leave the page.`
}

/** The images left out because they have a chosen take. */
export function chosenLine(names: readonly string[]): string {
  const one = names.length === 1
  return `${joined([...names])} ${one ? 'has' : 'have'} a chosen take and ${one ? 'gets' : 'get'} none.`
}

/** The images left out because they are already making takes. */
export function busyLine(names: readonly string[]): string {
  const one = names.length === 1
  return `${joined([...names])} ${one ? 'is' : 'are'} already making takes and ${one ? 'gets' : 'get'} none.`
}

/** The images left out because the game's lists disagree about them. */
export function disagreeLine(names: readonly string[]): string {
  const one = names.length === 1
  return `${joined([...names])} ${one ? 'gets' : 'get'} none: the game's lists disagree about ${one ? 'it' : 'them'}.`
}

/** The panel's line when the only images left to make are those the game's lists disagree about. */
export function nothingToMakeDisagreeLine(names: readonly string[]): string {
  return `No takes can be made for ${joined([...names])}: the game's lists disagree about ${names.length === 1 ? 'it' : 'them'}.`
}

/** The running line: what is being made in the act, and about how long is left. */
export function runningLine({
  takes,
  images: imageCount,
  left,
}: {
  takes: number
  images: number
  left: number
}): string {
  return `Making ${takes} ${takes === 1 ? 'take' : 'takes'} for ${images(imageCount)} · about ${timeText(left, 'up')} left`
}

/** The summary's first sentence: how many of the takes asked for were made. */
export function summaryLead(total: number, made: number): string {
  return `Made ${made} of ${total} takes.`
}

/** The text around the names of the images with a failed take. */
export function summaryFailed(
  count: number,
  names: readonly string[],
): { before: string; after: string } {
  return {
    before: `${count} could not be made — `,
    after: names.length === 1 ? ' says why.' : ' say why.',
  }
}

/** The summary's sentence about takes stopped. */
export function summaryStopped(count: number): string {
  return `${count} ${count === 1 ? 'was' : 'were'} stopped.`
}
