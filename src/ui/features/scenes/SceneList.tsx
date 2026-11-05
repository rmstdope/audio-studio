import type { LoudnessTarget, SceneMeasure } from '../../../core/sceneLoudness'
import type { SceneAct, SceneRow } from '../../../core/scenes'
import { routeHref } from '../../route'
import { listCount } from '../../scenesText'

/** The link to a scene of an act. */
const sceneHref = (act: SceneAct, scene: SceneRow) =>
  routeHref({ view: 'scenes', page: 'act', part: act.id, scene: scene.id })

/**
 * The act's scenes, which scroll on their own: a list of links where Tab stops once, on the open
 * scene, and the arrow keys move through the rest. In a narrow window it is a menu above the scene
 * showing the open scene's name.
 */
export function SceneList({
  act,
  open,
  unsaved,
  target,
  expected,
}: {
  act: SceneAct
  open: SceneRow
  /** The id of the scene with unsaved changes. */
  unsaved: string | null
  /** The loudness the project asks of the scenes; null: none is flagged. */
  target: LoudnessTarget | null
  /** The open scene's figures as the unsaved press expects them, if it made one. */
  expected: SceneMeasure | null
}) {
  const move = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a')]
    const next = links[links.indexOf(document.activeElement as HTMLAnchorElement) + step]
    if (!next) return
    event.preventDefault()
    next.focus()
  }
  return (
    <>
      <nav className="scene-list" aria-label="Scenes">
        <span className="label scene-list-count">
          {act.scenes.length === 1 ? '1 scene' : `${act.scenes.length} scenes`}
        </span>
        <ul onKeyDown={move}>
          {act.scenes.map((scene) => {
            const current = scene.id === open.id
            const count = listCount(scene, target, current ? expected : null)
            return (
              <li key={scene.id}>
                <a
                  href={sceneHref(act, scene)}
                  aria-current={current ? 'page' : undefined}
                  tabIndex={current ? 0 : -1}
                >
                  <span className="grow">
                    {scene.name}
                    {scene.id === unsaved && (
                      <span className="scene-dot" role="img" aria-label="Unsaved changes">
                        {' '}
                        ●
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      count.red
                        ? 'scene-count scene-count-red'
                        : count.warn
                          ? 'scene-count scene-count-warn'
                          : 'scene-count'
                    }
                  >
                    {count.text}
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
      <select
        className="scene-menu"
        aria-label="Scene"
        value={open.id}
        onChange={(event) => {
          const scene = act.scenes.find((s) => s.id === event.target.value)
          if (scene) window.location.hash = sceneHref(act, scene)
        }}
      >
        {act.scenes.map((scene) => (
          <option key={scene.id} value={scene.id}>
            {scene.id === unsaved ? `${scene.name} ●` : scene.name}
          </option>
        ))}
      </select>
    </>
  )
}
