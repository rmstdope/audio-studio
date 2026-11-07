import type { EffectTakeView } from '../core/effectTakes'
import type { Clip } from './player'

/** The id a take's play button is known by to the player. */
export const takePlayId = (effect: string, n: number) => `effect-take-${effect}-${n}`

/** Where a take's sound is served from: for a trimmed take, only the part between its cuts. */
export const takeUrl = (effect: string, take: Pick<EffectTakeView, 'file' | 'trim'>) =>
  `/api/effects/${encodeURIComponent(effect)}/takes/${encodeURIComponent(take.file)}${take.trim ? '?trimmed=1' : ''}`

/** The seconds of quiet between the chosen take and the one compared with it. */
const QUIET_SECONDS = 1

/** How many times a looping take is played round in a comparison. */
const COMPARE_ROUNDS = 2

/** A take as the player plays it in a comparison: a loop round twice, a take made to play once once. */
const compareClip = (effect: string, take: EffectTakeView, after?: number): Clip => ({
  id: takePlayId(effect, take.n),
  url: takeUrl(effect, take),
  ...(take.loops && { loop: true, rounds: COMPARE_ROUNDS }),
  ...(after !== undefined && { after }),
})

/** "The chosen, then this": the chosen take, a second of quiet, then `take`, each played as it was made. */
export function compareClips(effect: string, chosen: EffectTakeView, take: EffectTakeView): Clip[] {
  return [compareClip(effect, chosen, QUIET_SECONDS), compareClip(effect, take)]
}
