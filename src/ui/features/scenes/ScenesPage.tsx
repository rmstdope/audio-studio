import { useEffect } from 'react'
import type { SceneAct } from '../../../core/scenes'
import { useRefreshDialog } from '../../api'
import { Problems } from '../../components/Problems'
import { shortTitle } from '../../format'
import type { ScenesRoute } from '../../route'
import { currentScene, statesLine } from '../../scenesText'
import { useSceneClip } from '../../sceneClip'
import { SceneDetail } from './SceneDetail'
import { SceneList } from './SceneList'

/**
 * An act's Scenes page: its scenes on the left, the open one on the right (looked at, not yet
 * edited), and Refresh from the game, which reads the act's scenes, states and triggers again.
 */
export function ScenesPage({ act, route }: { act: SceneAct; route: ScenesRoute }) {
  const name = shortTitle(act.title)
  const run = useRefreshDialog(act.id)
  const player = useSceneClip()
  const scene = currentScene(act, route)
  // A clip sounding stops when another scene opens: its ▶ is not on the new scene's page.
  const { stop } = player
  useEffect(() => stop(), [scene?.id, stop])
  const refresh = (primary: boolean) =>
    act.canRefresh && (
      <button
        className={primary ? 'btn btn-primary' : 'btn'}
        type="button"
        disabled={run.pending}
        onClick={run.start}
      >
        {run.pending ? 'Refreshing from the game…' : 'Refresh from the game'}
      </button>
    )
  const result = run.outcome?.result
  const failed =
    run.outcome && !(result?.ok === true) ? (
      <section className="panel refresh-outcome scenes-failed" aria-label="Refresh from the game">
        <div className="refresh-head">
          <div>
            <strong>Refresh from the game failed.</strong>
            <span>The scenes shown are from the last refresh.</span>
          </div>
          <button className="btn" type="button" onClick={run.dismiss}>
            Close
          </button>
        </div>
        {result && 'problems' in result && (
          <Problems title="What the command wrote cannot be used" problems={result.problems} />
        )}
        <pre className="refresh-output mono">
          {(result && 'output' in result && result.output) ||
            (result && 'message' in result && result.message) ||
            run.outcome.error ||
            ''}
        </pre>
      </section>
    ) : null

  if (act.state !== 'ok' || !scene) {
    return (
      <>
        <header className="page-header">
          <div>
            <span className="crumbs">Scenes</span>
            <h1 tabIndex={-1}>{name}</h1>
          </div>
          {act.state !== 'missing' && <div className="header-actions">{refresh(false)}</div>}
        </header>
        {failed}
        <section className="panel scene-notice">
          {act.state === 'invalid' ? (
            <p className="muted music-notice">
              The scenes for {name} cannot be read; see the problems above.
            </p>
          ) : act.state === 'ok' ? (
            <p className="muted music-notice">The game lists no scenes in {name}.</p>
          ) : (
            <>
              <strong>The game hasn&apos;t listed its scenes yet.</strong>
              <span className="muted">
                Refresh from the game to read its scenes, their states and their triggers.
              </span>
              {refresh(true)}
            </>
          )}
        </section>
      </>
    )
  }
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">Scenes · {name}</span>
          <h1 tabIndex={-1}>{scene.name}</h1>
          <span className="muted">{statesLine(scene)}</span>
        </div>
        <div className="header-actions">{refresh(false)}</div>
      </header>
      {failed}
      <div className="scenes-body">
        <SceneList act={act} open={scene} />
        <div className="scene-open">
          {scene.unreadable ? (
            <section className="panel scene-panel">
              <p className="muted">
                This scene&apos;s entry in {act.mixFile} can&apos;t be read; see the problems above.
              </p>
            </section>
          ) : (
            <SceneDetail key={scene.id} scene={scene} player={player} />
          )}
        </div>
      </div>
    </>
  )
}
