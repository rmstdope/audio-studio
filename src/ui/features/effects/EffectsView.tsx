import type { ProjectSummary } from '../../../core/summary'
import type { EffectsRoute } from '../../route'
import { EffectPage } from './EffectPage'
import { EffectsList } from './EffectsList'
import { NoEffects } from './NoEffects'

/** A Sound effects page: the list, one effect, or how to set sound effects up when the project has none. */
export function EffectsView({ summary, route }: { summary: ProjectSummary; route: EffectsRoute }) {
  const { effects } = summary
  if (!effects) return <NoEffects />
  if (route.page === 'effect')
    return <EffectPage key={route.effect} effects={effects} id={route.effect} />
  return <EffectsList key="list" effects={effects} attention={route.show === 'attention'} />
}
