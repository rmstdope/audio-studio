import { EDIT_MODELS, type EditModelId } from '../core/imageModels'
import { timeText } from '../core/takeTimes'
import { joined } from './imagesText'

const patches = (n: number) => (n === 1 ? 'patch' : 'patches')
const takes = (n: number) => (n === 1 ? 'take' : 'takes')

/** The line's sentence: how many patches the press would remake, on which take of the image. */
export function remakeSentence(count: number, take: number): string {
  return `${count} ${patches(count)} to make again on take ${take}`
}

/** The small line under the press: what the takes are made from and why the person still looks. */
export const REMAKE_USES =
  'Each from the area and words it was chosen with. You still choose each one: the new picture may have moved what the area covered.'

/**
 * The line naming the patches left out for lack of an area: under the press while others are
 * remade, alone (and worded for having no area to make them from) when every covered patch is out.
 */
export function leftOutLine(titles: readonly string[], all: boolean): string {
  const one = titles.length === 1
  const names = joined([...titles])
  return all
    ? `${names} ${one ? 'has' : 'have'} no area to make ${one ? 'it' : 'them'} from: open ${one ? 'it' : 'them'} and mark ${one ? 'one' : 'one each'}.`
    : `${names} ${one ? 'gets' : 'get'} none: ${one ? 'its area is' : 'their areas are'} gone with the ${one ? 'take' : 'takes'} ${one ? 'it was' : 'they were'} made on. Open ${one ? 'it' : 'them'} and mark the ${one ? 'area' : 'areas'}.`
}

/** The progress line while the press runs. */
export function remakeProgress(
  total: number,
  patchCount: number,
  left: number,
  model: EditModelId,
): string {
  return `Making ${total} ${takes(total)} for ${patchCount} ${patches(patchCount)} with ${EDIT_MODELS[model].short} · about ${timeText(left, 'up')} left`
}

/** What the summary says besides the names of the patches with a failed take. */
export function remakeSummary(press: {
  total: number
  made: number
  stopped: number
  failedTakes: number
  patches: number
}): { lead: string; failed: { before: string; after: (names: number) => string } | null } {
  const { total, made, stopped, failedTakes } = press
  let lead = `Made ${made} of ${total} takes.`
  if (stopped > 0) lead += ` ${stopped} ${stopped === 1 ? 'was' : 'were'} stopped.`
  if (failedTakes === 0 && stopped === 0) {
    lead +=
      press.patches === 1
        ? ' Choose one to put the patch back in the game.'
        : ' Choose one for each patch to put it back in the game.'
  }
  return {
    lead,
    failed:
      failedTakes > 0
        ? {
            before: `${failedTakes} could not be made — `,
            after: (names) => (names === 1 ? ' says why.' : ' say why.'),
          }
        : null,
  }
}

/** What a closed row says while takes are made: how many, or that they wait their turn. */
export function rowMaking(making: readonly { state: 'waiting' | 'making' }[]): string {
  return making.some((m) => m.state === 'making')
    ? `Making ${making.length} ${takes(making.length)}`
    : 'Waiting'
}

/** The end of a closed row's text for takes that could not be made: " · 1 could not be made". */
export function rowFailed(count: number): string {
  return count > 0 ? ` · ${count} could not be made` : ''
}
