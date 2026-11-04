import { useRef } from 'react'
import type { SceneRow } from '../../../core/scenes'
import { PlayIcon, StopIcon } from '../../components/icons'
import { clock, muteSoloText } from '../../sceneNow'
import type { ScenePlay } from '../../sceneRun'

/**
 * The bar pinned at the bottom of the open scene: ▶ or ■, the time played (or Loading…), the
 * scene's state, its triggers, and the count of muted and soloed rows with Clear.
 */
export function PlayBar({
  scene,
  play,
  nothing,
}: {
  scene: SceneRow
  play: ScenePlay
  /** The scene has no music and no effects. */
  nothing: boolean
}) {
  const running = play.phase !== 'stopped'
  const startRef = useRef<HTMLButtonElement>(null)
  const count = muteSoloText(play.muted.size, play.soloed.size)
  return (
    <div className="scene-playbar" role="group" aria-label="Scene player">
      <button
        ref={startRef}
        className={running ? 'icon-btn music-stop' : 'icon-btn'}
        type="button"
        aria-label={running ? 'Stop the scene' : 'Start the scene'}
        aria-disabled={(nothing && !running) || undefined}
        onClick={() => !(nothing && !running) && play.toggle()}
      >
        {running ? <StopIcon /> : <PlayIcon />}
      </button>
      {nothing && !running ? (
        <span className="muted">Nothing to play in this scene</span>
      ) : (
        <span className="scene-clock muted">
          {play.phase === 'loading' ? 'Loading…' : clock(play.at)}
        </span>
      )}
      {scene.states.length > 0 && (
        <span className="scene-bar-group" role="group" aria-label="State">
          <span className="scene-bar-label">State</span>
          <span className="scene-seg">
            {scene.states.map((state) => (
              <button
                key={state}
                type="button"
                className={state === play.state ? 'on' : undefined}
                aria-pressed={state === play.state}
                onClick={() => play.setState(state)}
              >
                {state}
              </button>
            ))}
          </span>
        </span>
      )}
      {scene.triggers.length > 0 && (
        <span className="scene-bar-group" role="group" aria-label="Triggers">
          <span className="scene-bar-label">Triggers</span>
          {scene.triggers.map((trigger) => (
            <button
              key={trigger}
              type="button"
              className="btn sm"
              aria-disabled={play.phase !== 'playing' || undefined}
              onClick={() => play.phase === 'playing' && play.fire(trigger)}
            >
              {trigger} ⚡
            </button>
          ))}
        </span>
      )}
      <span className="scene-bar-grow" />
      {/* Always present, so the bar's height never depends on a solo or mute (as-lzp): its
          ::before holds the room for the count at its widest and Clear. A scene with nothing to
          play has no rows to solo or mute, so it keeps no room (as-0q9). */}
      {!nothing && (
        <span className="scene-bar-count">
          {count && (
            <span className="scene-bar-count-now">
              <span className="chip">{count}</span>
              <button
                className="btn sm"
                type="button"
                onClick={() => {
                  play.clear()
                  // Clear unmounts with the count, so focus goes to the bar's Start/Stop.
                  startRef.current?.focus()
                }}
              >
                Clear
              </button>
            </span>
          )}
        </span>
      )}
    </div>
  )
}
