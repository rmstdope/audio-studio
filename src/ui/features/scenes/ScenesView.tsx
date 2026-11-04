import type { ProjectSummary } from '../../../core/summary'
import type { ScenesRoute } from '../../route'
import { currentSceneAct } from '../../scenesText'
import { NoScenes } from './NoScenes'
import { ScenesPage } from './ScenesPage'

/** A Scenes page: an act's scenes with the open one; how to set Scenes up when the project has none. */
export function ScenesView({ summary, route }: { summary: ProjectSummary; route: ScenesRoute }) {
  const { scenes } = summary
  const act = scenes && currentSceneAct(scenes, route)
  if (!act) return <NoScenes />
  return <ScenesPage key={act.id} act={act} route={route} summary={scenes} />
}
