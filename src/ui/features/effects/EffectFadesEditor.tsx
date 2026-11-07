import { EFFECT_FADE_STEPS } from '../../../core/fades'
import type { EffectTakeView } from '../../../core/effectTakes'
import { useSetEffectFades } from '../../api'
import { takePlayId, takeUrl } from '../../effectsPlay'
import { FadesEditorBody } from '../music/FadesEditor'
import type { Player } from './EffectInTheGame'

/** A page of its own, without a track's "last pressed" key: its one editor shows its own failure. */
const alone = { shows: () => true, press: () => {} }

/**
 * The editor of a one-shot sound effect take's fades: the stingers' editor, with steps of 0.01 s,
 * over the whole take, saved on the effect's board (and written to the game when the take is the
 * chosen one).
 */
export function EffectFadesEditor({
  effect,
  take,
  chosen,
  player,
  onClose,
}: {
  effect: string
  take: EffectTakeView
  /** The take is the one the game plays. */
  chosen: boolean
  player: Player
  /** The editor is done (saved, removed or cancelled). */
  onClose: () => void
}) {
  const set = useSetEffectFades(effect)
  return (
    <FadesEditorBody
      take={take}
      part={{ seconds: take.seconds, peaks: take.peaks }}
      soundUrl={takeUrl(effect, take.file)}
      playId={takePlayId(effect, take.n)}
      steps={EFFECT_FADE_STEPS}
      set={set}
      actions={alone}
      chosen={chosen}
      player={player}
      onClose={onClose}
    />
  )
}
