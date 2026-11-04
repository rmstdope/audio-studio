import { cents, takesCount } from '../core/musicModels'

/** The minutes of a number of seconds, rounded up, never less than one. */
function minutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60))
}

/** What a list calls its entries: an act's music says "track", the Stingers page "stinger". */
export type Noun = 'track' | 'stinger'

const counted = (n: number, noun: Noun) => `${n} ${n === 1 ? noun : `${noun}s`}`

/** The panel's line: how many tracks one press would make takes for. */
export function readyLine(n: number, noun: Noun = 'track'): string {
  return `${counted(n, noun)} ${n === 1 ? 'has' : 'have'} no chosen take`
}

/** The question's heading: "Make 16 takes for 4 tracks?". */
export function makeAllHeading(takes: number, trackCount: number, noun: Noun = 'track'): string {
  return `Make ${takes} takes for ${counted(trackCount, noun)}?`
}

/** The panel's line when nothing is left to make: "Every track has a chosen take.". */
export function allChosenLine(noun: Noun): string {
  return `Every ${noun} has a chosen take.`
}

/** Why Refresh from the game is greyed on the Stingers page while takes are being made. */
export const REFRESH_BLOCKED_BY_TAKES =
  'Takes are being made for the stingers. Refresh when they are done, or Stop all.'

/** Why Make 4 takes each (and the question's Make) is greyed while the Stingers refresh runs. */
export const MAKE_BLOCKED_BY_REFRESH = 'Wait for the refresh from the game to finish.'

/** The question's line: the model, and the time on a free model or who bills on a paid one. */
export function makeAllLine({
  name,
  paid,
  seconds,
}: {
  name: string
  paid: boolean
  seconds: number
}): string {
  const lead = `Four takes each, on ${name}, the music model on Setup.`
  return paid
    ? `${lead} ElevenLabs bills each take.`
    : `${lead} About ${minutes(seconds)} min in all — they are made one after another, and you can leave the page.`
}

/** The question's Make button, with the total price on a paid model. */
export function makeAllButton(takes: number, price: number | null): string {
  return price === null ? `Make ${takes} takes` : `Make ${takes} takes · ${cents(price)}`
}

/** Names in words: "A", "A and B", "A, B and C". */
export function namesText(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What goes before each of `n` names so they read as `namesText` does. */
export function joinSeparators(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? '' : i === n - 1 ? ' and ' : ', '))
}

/** The tracks left out because they have a chosen take. */
export function chosenLine(names: readonly string[]): string {
  const one = names.length === 1
  return `${namesText(names)} ${one ? 'has' : 'have'} a chosen take and ${one ? 'gets' : 'get'} none.`
}

/** The tracks left out because the model cannot make them at their length. */
export function tooLongLine(names: readonly string[], model: string): string {
  const one = names.length === 1
  return `Left out: ${namesText(names)} ${one ? 'is' : 'are'} longer than ${model} can make — open a track to pick another model for it, or change the music model on Setup.`
}

/** The tracks left out because they are already making takes. */
export function busyLine(names: readonly string[]): string {
  const one = names.length === 1
  return `${namesText(names)} ${one ? 'is' : 'are'} already making takes and ${one ? 'gets' : 'get'} none.`
}

/** What the panel says when the model can make none of the tracks with no chosen take. */
export function nonePossibleLine(model: string, count: number): string {
  return count === 1
    ? `${model} can't make the track with no chosen take at its length.`
    : `${model} can't make any of the ${count} tracks with no chosen take at their length.`
}

/** The running line: what is being made in the act, and about how long is left. */
export function runningLine({
  takes,
  tracks: trackCount,
  left,
  noun = 'track',
}: {
  takes: number
  tracks: number
  left: number
  noun?: Noun
}): string {
  return `Making ${takesCount(takes)} for ${counted(trackCount, noun)} · about ${minutes(left)} min left`
}

/** The summary's first sentence: how many of the takes asked for were made. */
export function summaryLead(total: number, made: number): string {
  return `Made ${made} of ${total} takes.`
}

/** The text around the names of the tracks with a failed take. */
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
