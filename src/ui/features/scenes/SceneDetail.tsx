import { useEffect, useRef } from 'react'
import { effectName } from '../../../core/effects'
import {
  addEffect,
  rowProblems,
  switchMode,
  type EffectDraft,
  type PlayMode,
  type SceneDraft,
} from '../../../core/sceneEdit'
import type {
  SceneAct,
  SceneEffectChoice,
  SceneRow,
  ScenesSummary,
  TrackProblem,
} from '../../../core/scenes'
import { Menu } from '../../components/Menu'
import { CrossIcon, PlayIcon, StopIcon } from '../../components/icons'
import { routeHref } from '../../route'
import { audible, nowWords } from '../../sceneNow'
import { MUSIC_KEY, rowKey } from '../../scenePlayback'
import type { ScenePlay } from '../../sceneRun'
import { trackProblemChip } from '../../scenesText'
import { AddEffect } from './AddEffect'
import { LevelSlider } from './LevelSlider'

/** What plays clips on the page: the id of the one playing, and how to start, retune or stop one. */
export interface ScenePlayer {
  playing: string | null
  toggle: (id: string, url: string, how: { level: number; loop?: boolean }) => void
  setLevel: (id: string, level: number) => void
  stop: () => void
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

/** Why a scene's track plays nothing, linking to the track on the Music page. */
function TrackProblemChip({
  track,
  title,
  problem,
}: {
  track: string
  title: string
  problem: TrackProblem
}) {
  const chip = trackProblemChip(title, problem)
  return (
    <a
      className={chip.tone === 'danger' ? 'chip chip-danger' : 'chip chip-warn'}
      href={routeHref({ view: 'music', page: 'track', track })}
      title={chip.title}
    >
      {chip.text}
    </a>
  )
}

/** The words of each way of playing, as the How it plays menu offers them. */
const HOW: Record<PlayMode, string> = {
  loop: 'Round and round',
  random: 'Now and then',
  once: 'Once',
  trigger: 'On a trigger',
}

/** What the page knows of the game around one scene. */
interface Around {
  scene: SceneRow
  act: SceneAct
  choices: Map<string, SceneEffectChoice>
  effectsKnown: boolean
}

/** A box of seconds, red with its line's id as description when it cannot work. */
function Seconds({
  label,
  value,
  red,
  describedBy,
  onChange,
}: {
  label: string
  value: string
  red: boolean
  describedBy: string
  onChange: (value: string) => void
}) {
  return (
    <input
      className={red ? 'scene-num scene-bad' : 'scene-num'}
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={red || undefined}
      aria-describedby={red ? describedBy : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** The M and S toggle buttons of a row (or of the music). */
function MuteSolo({ name, id, play }: { name: string; id: string; play: ScenePlay }) {
  return (
    <>
      <button
        className={play.muted.has(id) ? 'scene-ms scene-ms-mute on' : 'scene-ms scene-ms-mute'}
        type="button"
        title="Mute"
        aria-label={`Mute ${name}`}
        aria-pressed={play.muted.has(id)}
        onClick={() => play.toggleMute(id)}
      >
        M
      </button>
      <button
        className={play.soloed.has(id) ? 'scene-ms scene-ms-solo on' : 'scene-ms scene-ms-solo'}
        type="button"
        title="Solo"
        aria-label={`Solo ${name}`}
        aria-pressed={play.soloed.has(id)}
        onClick={() => play.toggleSolo(id)}
      >
        S
      </button>
    </>
  )
}

/** What the music is doing, in the Now word after its level. */
function MusicNow({
  play,
  silent,
  gone,
  url,
}: {
  play: ScenePlay
  silent: boolean
  gone: boolean
  url: string
}) {
  const failed = play.failed.has(url)
  const words = nowWords(
    { kind: 'playing' },
    {
      state: play.state ?? '',
      muted: play.muted.has(MUSIC_KEY) && play.soloed.size === 0,
      notSoloed: play.soloed.size > 0 && !play.soloed.has(MUSIC_KEY),
      silent,
      gone,
      failed,
    },
  )
  return (
    <span
      className={failed ? 'scene-now scene-music-now scene-now-bad' : 'scene-now scene-music-now'}
    >
      {words}
    </span>
  )
}

/** Moving bars before "Playing". */
function Bars() {
  return (
    <span className="scene-eq" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}

/** One effect of the scene, with controls: how it plays, in which state, how loud, and ✕. */
function EffectRowView({
  effect,
  index,
  around,
  player,
  play,
  was,
  onChange,
  onRemove,
}: {
  effect: EffectDraft
  /** The effect's level before a press of the loudness suggestion, while that is unsaved. */
  was?: number
  index: number
  around: Around
  player: ScenePlayer
  play: ScenePlay
  onChange: (next: EffectDraft) => void
  onRemove: () => void
}) {
  const { scene } = around
  const choice = around.choices.get(effect.id)
  const goneEffect = around.effectsKnown && !choice
  const goneState = effect.state !== null && !scene.states.includes(effect.state)
  const goneTrigger =
    effect.mode === 'trigger' && effect.trigger !== null && !scene.triggers.includes(effect.trigger)
  const problems = rowProblems(effect)
  const errorId = `scene-error-${index}`
  const modes: PlayMode[] = ['loop', 'random', 'once']
  if (scene.triggers.length > 0 || effect.mode === 'trigger') modes.push('trigger')
  const clipId = `effect-${index}`
  const key = rowKey(index)
  const url = `/api/effects/${encodeURIComponent(effect.id)}/current`
  const now = play.rows[index]
  const heard = audible(key, play.muted, play.soloed)
  const muted = play.muted.has(key) && play.soloed.size === 0
  const notSoloed = play.soloed.size > 0 && !play.soloed.has(key)
  const showNow = play.phase !== 'stopped'
  const words =
    now && problems.lines.length === 0
      ? nowWords(now, {
          state: play.state ?? '',
          muted,
          notSoloed,
          silent: !!choice && (choice.silent || !choice.playable),
          gone: goneEffect || goneState || goneTrigger,
          failed: play.failed.has(url),
        })
      : ''
  const sounding = words.startsWith('Playing') && heard
  const dim = now?.kind === 'otherState' || !heard || words === 'Not played'
  return (
    <tr className={sounding ? 'scene-sounding' : dim && showNow ? 'scene-dim' : undefined}>
      <td
        className={showNow ? 'scene-now' : 'scene-now scene-now-idle'}
        title={showNow && words ? words : undefined}
      >
        {showNow && sounding && <Bars />}
        {showNow && (
          <span className={words.startsWith("Couldn't") ? 'scene-now-bad' : undefined}>
            {words}
          </span>
        )}
      </td>
      <td className="scene-play">
        {choice?.playable && (
          <PlayButton
            id={clipId}
            name={choice.name}
            url={url}
            level={effect.level}
            loop={choice.loops}
            player={player}
          />
        )}
      </td>
      <td className="scene-effect">
        <div className="scene-effect-cell">
          <span className="mono scene-effect-name" title={effect.id}>
            {effect.id}
          </span>
          {goneEffect ? (
            <GoneMark />
          ) : (
            choice?.silent && (
              <a
                className="chip chip-warn"
                href={routeHref({ view: 'effects', page: 'effect', effect: effect.id })}
              >
                no take chosen
              </a>
            )
          )}
        </div>
      </td>
      <td className="scene-how">
        <Menu
          label="How it plays"
          face={HOW[effect.mode]}
          value={effect.mode}
          options={modes.map((mode) => ({ value: mode, label: HOW[mode] }))}
          onChange={(mode) => onChange(switchMode(effect, mode as PlayMode, scene.triggers))}
        />
        {effect.mode === 'random' && (
          <span className="scene-seconds">
            every{' '}
            <Seconds
              label="Seconds, first number"
              value={effect.every[0]}
              red={problems.first}
              describedBy={errorId}
              onChange={(first) => onChange({ ...effect, every: [first, effect.every[1]] })}
            />
            –
            <Seconds
              label="Seconds, second number"
              value={effect.every[1]}
              red={problems.second}
              describedBy={errorId}
              onChange={(second) => onChange({ ...effect, every: [effect.every[0], second] })}
            />{' '}
            s
          </span>
        )}
        {effect.mode === 'once' && (
          <span className="scene-seconds">
            <Seconds
              label="Seconds after entering"
              value={effect.after}
              red={problems.after}
              describedBy={errorId}
              onChange={(after) => onChange({ ...effect, after })}
            />{' '}
            s after entering
          </span>
        )}
        {effect.mode === 'trigger' && (
          <>
            <Menu
              label="Trigger"
              face={effect.trigger ?? ''}
              value={effect.trigger}
              gone={goneTrigger}
              options={scene.triggers.map((t) => ({ value: t, label: t }))}
              onChange={(trigger) => onChange({ ...effect, trigger })}
            />
            {goneTrigger && <GoneMark />}
          </>
        )}
        {problems.lines.length > 0 && (
          <div className="scene-error" id={errorId}>
            {problems.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        )}
      </td>
      <td className="scene-state">
        {scene.states.length === 0 && effect.state === null ? (
          'Always'
        ) : (
          <>
            <Menu
              label="In which state"
              face={effect.state ?? 'Always'}
              value={effect.state}
              gone={goneState}
              options={[
                { value: null, label: 'Always' },
                ...scene.states.map((s) => ({ value: s, label: s })),
              ]}
              onChange={(state) => onChange({ ...effect, state })}
            />
            {goneState && <GoneMark />}
          </>
        )}
      </td>
      <td className="scene-level-cell">
        <LevelSlider
          label={`Level of ${choice?.name ?? effectName(effect.id)}`}
          level={effect.level}
          was={was}
          onChange={(level) => {
            player.setLevel(clipId, level)
            onChange({ ...effect, level })
          }}
        />
      </td>
      <td className="scene-m">
        <MuteSolo name={choice?.name ?? effectName(effect.id)} id={key} play={play} />
      </td>
      <td className="scene-remove">
        <button
          className="icon-btn"
          type="button"
          aria-label="Remove"
          title="Remove"
          data-remove={index}
          onClick={onRemove}
        >
          <CrossIcon />
        </button>
      </td>
    </tr>
  )
}

/**
 * The open scene, to look at and to change: its music and its sound effects. Changes go to
 * `onChange`; nothing is saved here.
 */
export function SceneDetail({
  scene,
  act,
  summary,
  draft,
  player,
  play,
  was,
  onChange,
}: {
  scene: SceneRow
  act: SceneAct
  summary: Pick<ScenesSummary, 'effects' | 'effectsKnown'>
  draft: SceneDraft
  player: ScenePlayer
  play: ScenePlay
  /** The scene as saved, while a press of the loudness suggestion is unsaved: its moved levels show as changed. */
  was?: SceneDraft | null
  onChange: (next: SceneDraft) => void
}) {
  const around: Around = {
    scene,
    act,
    choices: new Map(summary.effects.map((c) => [c.id, c])),
    effectsKnown: summary.effectsKnown,
  }
  const { music } = draft
  const track = act.tracks.find((t) => t.id === music.track)
  const trackGone = music.track !== null && music.track === scene.music.track && scene.music.gone
  const trackName = track?.title ?? (music.track === scene.music.track ? scene.music.name : null)
  const table = useRef<HTMLTableSectionElement>(null)
  // After ✕, focus goes to the next row's ✕, or to Add if it was the last.
  const focusAfterRemove = useRef<number | null>(null)
  useEffect(() => {
    const at = focusAfterRemove.current
    if (at === null) return
    focusAfterRemove.current = null
    const remove = table.current?.querySelectorAll<HTMLButtonElement>('[data-remove]')[at]
    ;(remove ?? document.querySelector<HTMLButtonElement>('[data-add]'))?.focus()
  }, [draft.effects.length])

  return (
    <>
      <section className="panel scene-panel" aria-label="Music">
        <h2>Music</h2>
        <div className="scene-music">
          {music.track !== null && track?.playable && (
            <PlayButton
              id="music"
              name={track.title}
              url={`/api/music/tracks/${encodeURIComponent(music.track)}/current`}
              level={music.level}
              loop
              player={player}
            />
          )}
          <Menu
            label="Music"
            face={music.track === null ? 'No music' : (trackName ?? music.track)}
            value={music.track}
            gone={trackGone}
            options={[
              { value: null, label: 'No music' },
              ...act.tracks.map((t) => ({ value: t.id, label: t.title })),
            ]}
            onChange={(next) => {
              if (player.playing === 'music') player.stop()
              onChange({ ...draft, music: { ...music, track: next } })
            }}
          />
          {trackGone && <GoneMark />}
          {music.track !== null && track?.problem && !trackGone && (
            <TrackProblemChip track={music.track} title={track.title} problem={track.problem} />
          )}
          {music.track !== null && (
            <LevelSlider
              label="Music level"
              level={music.level}
              was={was?.music.level}
              onChange={(level) => {
                player.setLevel('music', level)
                onChange({ ...draft, music: { ...music, level } })
              }}
            />
          )}
          {music.track !== null && play.phase === 'playing' && (
            <MusicNow
              play={play}
              silent={!track?.playable && !trackGone}
              gone={trackGone}
              url={`/api/music/tracks/${encodeURIComponent(music.track)}/current`}
            />
          )}
          {music.track !== null && <MuteSolo name="the music" id={MUSIC_KEY} play={play} />}
        </div>
      </section>
      <section className="panel scene-panel scene-effects" aria-label="Sound effects">
        <h2>Sound effects</h2>
        {draft.effects.length === 0 ? (
          <p className="muted">No sound effects in this scene.</p>
        ) : (
          <table className="table stack-table">
            <thead>
              <tr>
                {play.phase !== 'stopped' && <th className="scene-now-head">Now</th>}
                <th aria-label="Play" />
                <th>Effect</th>
                <th>How it plays</th>
                <th>In which state</th>
                <th>Level</th>
                <th aria-label="Mute and solo" />
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody ref={table}>
              {draft.effects.map((effect, index) => (
                <EffectRowView
                  key={index}
                  effect={effect}
                  index={index}
                  around={around}
                  player={player}
                  play={play}
                  was={was?.effects[index]?.level}
                  onChange={(next) =>
                    onChange({
                      ...draft,
                      effects: draft.effects.map((e, i) => (i === index ? next : e)),
                    })
                  }
                  onRemove={() => {
                    player.stop()
                    play.dropRow(index)
                    focusAfterRemove.current = index
                    onChange({ ...draft, effects: draft.effects.filter((_, i) => i !== index) })
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
        <AddEffect
          choices={summary.effects}
          player={player}
          onAdd={(choice) => onChange(addEffect(draft, choice))}
        />
      </section>
    </>
  )
}
