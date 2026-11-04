import type { SceneEffectRow, SceneRow } from '../../../core/scenes'
import { PlayIcon, StopIcon } from '../../components/icons'
import { routeHref } from '../../route'
import { howItPlays, levelText } from '../../scenesText'

/** What plays clips on the page: the id of the one playing, and how to start or stop one. */
export interface ScenePlayer {
  playing: string | null
  toggle: (id: string, url: string, how: { level: number; loop?: boolean }) => void
}

/** A ▶ that plays one clip alone at its level, ■ while it plays. */
function PlayButton({
  id,
  name,
  url,
  level,
  loop,
  player,
}: {
  id: string
  name: string
  url: string
  level: number
  loop: boolean
  player: ScenePlayer
}) {
  const playing = player.playing === id
  return (
    <button
      className={playing ? 'icon-btn music-stop' : 'icon-btn'}
      type="button"
      aria-label={playing ? `Stop ${name}` : `Play ${name}`}
      onClick={() => player.toggle(id, url, { level, loop })}
    >
      {playing ? <StopIcon /> : <PlayIcon />}
    </button>
  )
}

/** A red mark: the game no longer has this. */
function GoneMark() {
  return <span className="chip chip-danger">gone from the game</span>
}

/** One effect of the scene: how it plays, in which state, how loud. */
function EffectRowView({
  effect,
  index,
  player,
}: {
  effect: SceneEffectRow
  index: number
  player: ScenePlayer
}) {
  return (
    <tr>
      <td className="scene-play">
        {effect.playable && (
          <PlayButton
            id={`effect-${index}`}
            name={effect.name}
            url={`/api/effects/${encodeURIComponent(effect.id)}/current`}
            level={effect.level}
            loop={effect.loops}
            player={player}
          />
        )}
      </td>
      <td className="scene-effect">
        <span className="mono">{effect.id}</span>
        {effect.goneEffect ? (
          <GoneMark />
        ) : (
          effect.silent && (
            <a
              className="chip chip-warn"
              href={routeHref({ view: 'effects', page: 'effect', effect: effect.id })}
            >
              no take chosen
            </a>
          )
        )}
      </td>
      <td className="scene-how">
        {howItPlays(effect.play)}
        {effect.goneTrigger && <GoneMark />}
      </td>
      <td className="scene-state">
        {effect.state ?? 'Always'}
        {effect.goneState && <GoneMark />}
      </td>
      <td className="scene-level">{levelText(effect.level)}</td>
    </tr>
  )
}

/** The open scene: its music and its sound effects, as words and numbers. */
export function SceneDetail({ scene, player }: { scene: SceneRow; player: ScenePlayer }) {
  const { music } = scene
  return (
    <>
      <section className="panel scene-panel" aria-label="Music">
        <h2>Music</h2>
        {music.track === null ? (
          <p className="muted">No music</p>
        ) : (
          <div className="scene-music">
            {music.playable && (
              <PlayButton
                id="music"
                name={music.name ?? music.track}
                url={`/api/music/tracks/${encodeURIComponent(music.track)}/current`}
                level={music.level}
                loop
                player={player}
              />
            )}
            <span>{music.name}</span>
            {music.gone && <GoneMark />}
            <span className="scene-level">{levelText(music.level)}</span>
          </div>
        )}
      </section>
      <section className="panel scene-panel scene-effects" aria-label="Sound effects">
        <h2>Sound effects</h2>
        {scene.effects.length === 0 ? (
          <p className="muted">No sound effects in this scene.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th aria-label="Play" />
                <th>Effect</th>
                <th>How it plays</th>
                <th>In which state</th>
                <th>Level</th>
              </tr>
            </thead>
            <tbody>
              {scene.effects.map((effect, index) => (
                <EffectRowView key={index} effect={effect} index={index} player={player} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
