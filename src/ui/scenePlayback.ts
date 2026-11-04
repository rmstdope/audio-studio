import {
  createSceneEngine,
  STATE_FADE_SECONDS,
  type Cue,
  type EngineRow,
  type RowNow,
} from '../core/sceneEngine'
import type { LoopBuffer, LoopContext } from './loopAudio'
import { audible } from './sceneNow'

/** How long choosing another music track crossfades, in seconds. */
export const MUSIC_CROSSFADE_SECONDS = 1

/** What a scene plays: the music, the effect rows, and the state. */
export interface PlayScene {
  /** The music's clip, or null for none (or one that cannot sound). */
  music: { url: string | null; level: number }
  rows: PlayRow[]
  /** The state the scene is in; null for a scene with no states. */
  state: string | null
}

/** One effect row to play: the url null when there is nothing to sound (no take). */
export interface PlayRow {
  id: string
  play: EngineRow['play']
  state: string | null
  level: number
  url: string | null
}

/** Mute and solo, by `rowKey`; the music is `MUSIC_KEY`. */
export interface MixSets {
  muted: Set<string>
  soloed: Set<string>
}

/** The key of the music in the mute and solo sets. */
export const MUSIC_KEY = 'music'

/** The key of the effect row at `index` in the mute and solo sets. */
export const rowKey = (index: number) => `row:${index}`

/** Where playing stands, for the page. */
export interface PlaybackView {
  phase: 'stopped' | 'loading' | 'playing'
  /** Seconds since the scene was entered. */
  at: number
  /** What each effect row is doing; empty while stopped or loading. */
  rows: RowNow[]
  /** The urls that could not be loaded. */
  failed: Set<string>
}

/** The part of a Web Audio gain node that ramps; tests may leave the ramps out. */
interface RampGain {
  gain: {
    value: number
    cancelScheduledValues?(when: number): void
    setValueAtTime?(value: number, when: number): void
    linearRampToValueAtTime?(value: number, when: number): void
  }
  connect(node: unknown): unknown
}

/** A Web Audio context for playing a scene. */
export type PlaybackContext = Omit<LoopContext, 'createGain'> & { createGain(): RampGain }

/** What a scene player runs on, so tests can give it a fake clock and context. */
export interface PlaybackWeb {
  context: () => PlaybackContext
  load: (url: string) => Promise<ArrayBuffer>
  random: () => number
  /** Calls `fn` every `ms` until the returned function is called. */
  every: (fn: () => void, ms: number) => () => void
}

/** How often the clock and the Now words are refreshed, in milliseconds. */
export const TICK_MS = 250

/** A sounding clip: its source and its two gains (fade, and level times mute/solo). */
interface Voice {
  source: ReturnType<LoopContext['createBufferSource']>
  fade: RampGain
  level: RampGain
}

/**
 * Plays a scene as the game does (§8.11), on Web Audio, with the rules in `createSceneEngine`.
 * `start` loads every clip first, then enters the scene; `update` is given the scene as the page
 * now has it (an edit, heard at once); `setMix` the mute and solo sets; `once` plays a clip over the
 * scene. `onChange` hears the view on every tick and every change.
 */
export function createScenePlayback(web: PlaybackWeb, onChange: (view: PlaybackView) => void) {
  let ctx: PlaybackContext | null = null
  const buffers = new Map<string, Promise<LoopBuffer>>()
  const failed = new Set<string>()
  let phase: PlaybackView['phase'] = 'stopped'
  let token = 0
  let stopTicking: (() => void) | null = null
  let engine = createSceneEngine({ random: web.random })
  let t0 = 0
  let scene: PlayScene | null = null
  let mix: MixSets = { muted: new Set(), soloed: new Set() }
  let slots: number[] = []
  const voices = new Map<number, Voice>()
  let music: { url: string; voice: Voice } | null = null

  const now = () => (ctx ? ctx.currentTime - t0 : 0)
  const view = (): PlaybackView => ({
    phase,
    at: phase === 'playing' ? now() : 0,
    rows: phase === 'playing' ? slots.map((slot) => engine.now(slot, now())) : [],
    failed: new Set(failed),
  })
  const emit = () => onChange(view())

  const load = (url: string): Promise<LoopBuffer> => {
    const context = (ctx ??= web.context())
    let decoding = buffers.get(url)
    if (!decoding) {
      decoding = web.load(url).then((data) => context.decodeAudioData(data))
      buffers.set(url, decoding)
      decoding.catch(() => buffers.delete(url))
    }
    return decoding
  }
  /** Loads every url, noting the ones that fail. */
  const loadAll = async (urls: (string | null)[]) => {
    await Promise.all(
      urls.map((url) =>
        url === null
          ? null
          : load(url).then(
              () => failed.delete(url),
              () => void failed.add(url),
            ),
      ),
    )
  }
  const ready = (url: string | null) =>
    url !== null && !failed.has(url) && buffers.has(url) ? url : null
  const seconds = (url: string | null): Promise<number | null> => {
    const u = ready(url)
    return u === null ? Promise.resolve(null) : buffers.get(u)!.then((b) => b.duration)
  }

  const ramp = (gain: RampGain, to: number, over: number) => {
    const param = gain.gain
    if (param.linearRampToValueAtTime && param.setValueAtTime && ctx) {
      param.cancelScheduledValues?.(ctx.currentTime)
      param.setValueAtTime(param.value, ctx.currentTime)
      param.linearRampToValueAtTime(to, ctx.currentTime + over)
    } else param.value = to
  }

  /** Sounds a clip: through a fade gain (in over `fadeIn`, or at once) and a level gain. */
  const sound = async (
    url: string,
    loop: boolean,
    level: number,
    fadeIn: number,
  ): Promise<Voice | null> => {
    const context = ctx!
    const buffer = await buffers.get(url)!
    const fade = context.createGain()
    const levelGain = context.createGain()
    fade.gain.value = fadeIn > 0 ? 0 : 1
    levelGain.gain.value = level
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = loop
    source.connect(fade)
    fade.connect(levelGain)
    levelGain.connect(context.destination)
    source.start(0, 0)
    if (fadeIn > 0) ramp(fade, 1, fadeIn)
    return { source, fade, level: levelGain }
  }
  const end = (voice: Voice, fadeOut: number) => {
    if (fadeOut > 0) {
      ramp(voice.fade, 0, fadeOut)
      voice.source.stop(ctx!.currentTime + fadeOut)
    } else voice.source.stop()
  }

  /** The level a row's gain should have: its level, silent when it is not heard. */
  const rowLevel = (index: number) =>
    audible(rowKey(index), mix.muted, mix.soloed) ? (scene?.rows[index]?.level ?? 0) : 0
  const musicLevel = () =>
    audible(MUSIC_KEY, mix.muted, mix.soloed) ? (scene?.music.level ?? 0) : 0

  const act = async (cues: Cue[], local: PlayScene, mine: number) => {
    for (const cue of cues) {
      const index = slots.indexOf(cue.slot)
      const row = local.rows[index]
      if (cue.kind === 'stop') {
        const voice = voices.get(cue.slot)
        if (voice) end(voice, cue.fade ? STATE_FADE_SECONDS : 0)
        voices.delete(cue.slot)
        continue
      }
      if (!row || ready(row.url) === null) continue
      const voice = await sound(
        row.url!,
        cue.loop,
        rowLevel(index),
        cue.fade ? STATE_FADE_SECONDS : 0,
      )
      if (mine !== token || !voice) {
        if (voice) end(voice, 0)
        continue
      }
      voices.set(cue.slot, voice)
    }
  }

  const engineRows = async (local: PlayScene): Promise<EngineRow[]> =>
    Promise.all(
      local.rows.map(async (row) => ({
        id: row.id,
        play: row.play,
        state: row.state,
        seconds: await seconds(row.url),
      })),
    )

  const setMusic = async (mine: number) => {
    if (!scene) return
    const url = ready(scene.music.url)
    if (music && music.url === url) return
    const old = music
    music = null
    if (old) end(old.voice, MUSIC_CROSSFADE_SECONDS)
    if (url === null) return
    const voice = await sound(url, true, musicLevel(), old ? MUSIC_CROSSFADE_SECONDS : 0)
    if (mine !== token || !voice) {
      if (voice) end(voice, 0)
      return
    }
    music = { url, voice }
  }

  const tick = () => {
    if (phase !== 'playing') return
    void act(engine.advance(now()), scene!, token)
    emit()
  }

  const silenceAll = (fade: number) => {
    for (const voice of voices.values()) end(voice, fade)
    voices.clear()
    if (music) end(music.voice, fade)
    music = null
  }

  return {
    /** Loads the scene's clips, then enters it. A second press while loading does nothing. */
    async start(first: PlayScene): Promise<void> {
      if (phase !== 'stopped') return
      const mine = ++token
      phase = 'loading'
      scene = first
      emit()
      ctx ??= web.context()
      await ctx.resume?.()
      await loadAll([first.music.url, ...first.rows.map((r) => r.url)])
      if (mine !== token) return
      const rows = await engineRows(scene!)
      if (mine !== token) return
      engine = createSceneEngine({ random: web.random })
      slots = rows.map((_, i) => i)
      t0 = ctx.currentTime
      phase = 'playing'
      await setMusic(mine)
      if (mine !== token) return
      void act(engine.enter(rows, scene!.state, 0), scene!, mine)
      stopTicking = web.every(tick, TICK_MS)
      emit()
    },

    /** Fades everything out and stops; also cancels a start that is loading. */
    stop(): void {
      token++
      stopTicking?.()
      stopTicking = null
      silenceAll(STATE_FADE_SECONDS)
      slots = []
      phase = 'stopped'
      emit()
    },

    /** The scene as the page has it now: an edit, heard at once. */
    async update(next: PlayScene): Promise<void> {
      const previous = scene
      scene = next
      if (phase !== 'playing') return
      const mine = token
      await loadAll([next.music.url, ...next.rows.map((r) => r.url)])
      if (mine !== token) return
      if (previous && previous.music.url !== next.music.url) await setMusic(mine)
      if (mine !== token) return
      const rows = await engineRows(next)
      if (mine !== token) return
      if (next.state !== previous?.state) void act(engine.setState(next.state, now()), next, mine)
      const change = engine.setRows(rows, now())
      slots = change.slots
      for (const cue of change.cues) if (cue.kind === 'stop') void act([cue], next, mine)
      void act(
        change.cues.filter((c) => c.kind === 'start'),
        next,
        mine,
      )
      this.setLevel()
      emit()
    },

    /** Mute and solo changed: each sound fades to its level, or to silence. */
    setMix(next: MixSets): void {
      mix = next
      if (phase !== 'playing') return
      slots.forEach((slot, index) => {
        const voice = voices.get(slot)
        if (voice) ramp(voice.level, rowLevel(index), STATE_FADE_SECONDS)
      })
      if (music) ramp(music.voice.level, musicLevel(), STATE_FADE_SECONDS)
    },

    /** A level changed: heard at once. */
    setLevel(): void {
      if (phase !== 'playing' || !scene) return
      slots.forEach((slot, index) => {
        const voice = voices.get(slot)
        if (voice) voice.level.gain.value = rowLevel(index)
      })
      if (music) music.voice.level.gain.value = musicLevel()
    },

    /** The scene's state becomes `state`. */
    setState(state: string | null): void {
      if (scene) scene = { ...scene, state }
      if (phase === 'playing' && scene) void act(engine.setState(state, now()), scene, token)
      emit()
    },

    /** The game fires `trigger`. */
    fire(trigger: string): void {
      if (phase === 'playing' && scene) void act(engine.fire(trigger, now()), scene, token)
      emit()
    },

    /** Plays one clip over the scene at `level`, whatever mute and solo say. */
    async once(url: string, level: number): Promise<void> {
      await loadAll([url])
      if (ready(url) === null) return
      await sound(url, false, level, 0)
    },

    /** The current view. */
    view,
  }
}
