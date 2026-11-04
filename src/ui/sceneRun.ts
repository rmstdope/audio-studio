import { useCallback, useEffect, useRef, useState } from 'react'
import { rowProblems, toMix, type SceneDraft } from '../core/sceneEdit'
import type { RowNow } from '../core/sceneEngine'
import type { SceneAct, SceneEffectChoice, SceneRow } from '../core/scenes'
import {
  createScenePlayback,
  MUSIC_KEY,
  rowKey,
  type PlayScene,
  type PlaybackView,
} from './scenePlayback'

/** The scene as the page has it, ready to play: urls for what can sound, the state it is in. */
export function playSceneOf(
  act: SceneAct,
  draft: SceneDraft,
  choices: SceneEffectChoice[],
  state: string | null,
): PlayScene {
  const track = act.tracks.find((t) => t.id === draft.music.track)
  const mix = toMixSafe(draft)
  return {
    state,
    music: {
      url:
        draft.music.track !== null && track?.playable
          ? `/api/music/tracks/${encodeURIComponent(draft.music.track)}/current`
          : null,
      level: draft.music.level,
    },
    rows: draft.effects.map((effect, index) => {
      const choice = choices.find((c) => c.id === effect.id)
      const red = rowProblems(effect).lines.length > 0
      return {
        id: effect.id,
        play: mix.effects[index]!.play,
        state: effect.state,
        level: effect.level,
        url:
          !red && choice?.playable ? `/api/effects/${encodeURIComponent(effect.id)}/current` : null,
      }
    }),
  }
}

/** `toMix` for a draft that may have red rows: their numbers are not read. */
function toMixSafe(draft: SceneDraft) {
  return toMix({
    ...draft,
    effects: draft.effects.map((e) =>
      rowProblems(e).lines.length > 0 ? { ...e, mode: 'loop' } : e,
    ),
  })
}

/** The mute or solo keys after the effect row at `index` is removed. */
export function dropKey(keys: Set<string>, index: number): Set<string> {
  const next = new Set<string>()
  for (const key of keys) {
    const at = /^row:(\d+)$/.exec(key)?.[1]
    if (at === undefined) next.add(key)
    else if (Number(at) < index) next.add(key)
    else if (Number(at) > index) next.add(rowKey(Number(at) - 1))
  }
  return next
}

/** Playing the open scene, as the page uses it. */
export interface ScenePlay {
  phase: PlaybackView['phase']
  /** Seconds since the scene was entered. */
  at: number
  /** The state the scene is in (or will start in), or null for a scene with none. */
  state: string | null
  setState: (state: string) => void
  /** What each effect row is doing; empty unless playing. */
  rows: RowNow[]
  /** The urls that could not be loaded. */
  failed: Set<string>
  /** ▶ or ■ of the play bar. */
  toggle: () => void
  fire: (trigger: string) => void
  muted: Set<string>
  soloed: Set<string>
  toggleMute: (key: string) => void
  toggleSolo: (key: string) => void
  clear: () => void
  /** The effect row at `index` was removed. */
  dropRow: (index: number) => void
  /** Plays one clip over the scene. */
  once: (url: string, level: number) => void
  /** Stops playing, resets State and clears Mute and Solo (another scene opened). */
  reset: () => void
  stop: () => void
}

/**
 * Plays the open scene as the game does, from what is on the page: the play bar's state, Mute and
 * Solo, and the scheduler's view of each row. Nothing of it is saved.
 */
export function useScenePlay(
  scene: SceneRow | undefined,
  act: SceneAct,
  draft: SceneDraft,
  choices: SceneEffectChoice[],
  beforeStart: () => void,
): ScenePlay {
  const [view, setView] = useState<PlaybackView>({
    phase: 'stopped',
    at: 0,
    rows: [],
    failed: new Set(),
  })
  const [chosen, setChosen] = useState<string | null>(null)
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [soloed, setSoloed] = useState<Set<string>>(new Set())
  const playback = useRef<ReturnType<typeof createScenePlayback> | null>(null)
  playback.current ??= createScenePlayback(
    {
      context: () => new AudioContext(),
      load: async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`${url} could not be loaded`)
        return response.arrayBuffer()
      },
      random: Math.random,
      every: (fn, ms) => {
        const timer = setInterval(fn, ms)
        return () => clearInterval(timer)
      },
    },
    setView,
  )
  const run = playback.current
  const state = scene
    ? chosen !== null && scene.states.includes(chosen)
      ? chosen
      : (scene.states[0] ?? null)
    : null
  const playScene = scene ? playSceneOf(act, draft, choices, state) : null
  const latest = useRef({ playScene, muted, soloed })
  latest.current = { playScene, muted, soloed }

  // What is on the page is what plays: every change is heard at once.
  const signature = JSON.stringify(playScene)
  useEffect(() => {
    if (latest.current.playScene) void run.update(latest.current.playScene)
  }, [signature, run])
  useEffect(() => {
    run.setMix({ muted, soloed })
  }, [muted, soloed, run])
  useEffect(() => () => run.stop(), [run])

  const toggleIn = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }
  const stop = useCallback(() => run.stop(), [run])
  const reset = useCallback(() => {
    run.stop()
    setChosen(null)
    setMuted(new Set())
    setSoloed(new Set())
  }, [run])
  return {
    phase: view.phase,
    at: view.at,
    state,
    setState: (next) => {
      setChosen(next)
      run.setState(next)
    },
    rows: view.rows,
    failed: view.failed,
    toggle: () => {
      if (view.phase !== 'stopped') return run.stop()
      if (!latest.current.playScene) return
      beforeStart()
      run.setMix({ muted, soloed })
      void run.start(latest.current.playScene)
    },
    fire: run.fire,
    muted,
    soloed,
    toggleMute: (key) => setMuted((set) => toggleIn(set, key)),
    toggleSolo: (key) => setSoloed((set) => toggleIn(set, key)),
    clear: () => {
      setMuted(new Set())
      setSoloed(new Set())
    },
    dropRow: (index) => {
      setMuted((set) => dropKey(set, index))
      setSoloed((set) => dropKey(set, index))
    },
    once: (url, level) => void run.once(url, level),
    reset,
    stop,
  }
}

export { MUSIC_KEY, rowKey }
