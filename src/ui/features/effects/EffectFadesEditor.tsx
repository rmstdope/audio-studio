import { EFFECT_FADE_STEPS } from '../../../core/fades'
import type { EffectTakeView } from '../../../core/effectTakes'
import { useSetEffectFades } from '../../api'
import { takePlayId, takeUrl } from '../../effectsPlay'
import { cutShares, playedSeconds } from '../music/trimSilence'
import { FadesEditorBody } from '../music/FadesEditor'
import type { Player } from './EffectInTheGame'

/** A page of its own, without a track's "last pressed" key: its one editor shows its own failure. */
const alone = { shows: () => true, press: () => {} }

/**
 * The editor of a one-shot sound effect take's fades: the stingers' editor, with steps of 0.01 s,
 * over the take (the part between its cuts if it is trimmed), saved on the effect's board (and written to the game when the take is the
 * chosen one).
 */
export function EffectFadesEditor({
  effect,
  take,
  chosen,
  player,
  onClose,
  onSaved,
}: {
  effect: string
  take: EffectTakeView
  /** The take is the one the game plays. */
  chosen: boolean
  player: Player
  /** The editor is done (saved, removed or cancelled). */
  onClose: () => void
  /** The fades were saved or removed. */
  onSaved: () => void
}) {
  const set = useSetEffectFades(effect)
  // A trimmed take is faded after the cut: the length, the bars and the sound are of the part between the cuts.
  const cut = cutShares(take)
  const part = {
    seconds: playedSeconds(take),
    peaks: cut
      ? take.peaks.slice(
          Math.floor(cut.start * take.peaks.length),
          Math.ceil((1 - cut.end) * take.peaks.length),
        )
      : take.peaks,
  }
  return (
    <FadesEditorBody
      take={take}
      part={part}
      soundUrl={takeUrl(effect, take)}
      playId={takePlayId(effect, take.n)}
      steps={EFFECT_FADE_STEPS}
      set={set}
      actions={alone}
      chosen={chosen}
      player={player}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}
