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
  // The clips that are decoded, so that sounding one needs no waiting.
  const decoded = new Map<string, LoopBuffer>()
  const failed = new Set<string>()
  let phase: PlaybackView['phase'] = 'stopped'
  let token = 0
  let stopTicking: (() => void) | null = null
  let engine = createSceneEngine({ random: web.random })
  let t0 = 0
  // What the page has now; and what the slots describe while playing.
  let latest: PlayScene | null = null
  let live: PlayScene | null = null
  let mix: MixSets = { muted: new Set(), soloed: new Set() }
  let slots: number[] = []
  // A trigger fired again while its clip sounds adds a voice to its slot's list.
  const voices = new Map<number, Voice[]>()
  // Clips played once over the scene by a row's ▶.
  const overs: Voice[] = []
  let music: { url: string; voice: Voice } | null = null
  // Edits being applied: Mute and Solo wait for them, their keys are about the new rows.
  let updating = 0

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
              (buffer) => {
                decoded.set(url, buffer)
                failed.delete(url)
              },
              () => void failed.add(url),
            ),
      ),
    )
  }
  const ready = (url: string | null) =>
    url !== null && !failed.has(url) && decoded.has(url) ? url : null
  const seconds = (url: string | null): number | null => {
    const u = ready(url)
    return u === null ? null : decoded.get(u)!.duration
  }

  const ramp = (gain: RampGain, to: number, over: number) => {
    const param = gain.gain
    if (param.linearRampToValueAtTime && param.setValueAtTime && ctx) {
      param.cancelScheduledValues?.(ctx.currentTime)
      param.setValueAtTime(param.value, ctx.currentTime)
      param.linearRampToValueAtTime(to, ctx.currentTime + over)
    } else param.value = to
  }

  /** Sets a gain to `to` at once, over anything it was ramping to. */
  const setNow = (gain: RampGain, to: number) => {
    const param = gain.gain
    if (param.setValueAtTime && ctx) {
      param.cancelScheduledValues?.(ctx.currentTime)
      param.setValueAtTime(to, ctx.currentTime)
    }
    param.value = to
  }

  /** Takes a voice out of the lists it is kept in. */
  const forget = (voice: Voice) => {
    for (const [slot, list] of voices) {
      const rest = list.filter((v) => v !== voice)
      if (rest.length === 0) voices.delete(slot)
      else if (rest.length !== list.length) voices.set(slot, rest)
    }
    const at = overs.indexOf(voice)
    if (at >= 0) overs.splice(at, 1)
  }

  /** Sounds a decoded clip: through a fade gain (in over `fadeIn`, or at once) and a level gain. */
  const sound = (url: string, loop: boolean, level: number, fadeIn: number): Voice => {
    const context = ctx!
    const fade = context.createGain()
    const levelGain = context.createGain()
    fade.gain.value = fadeIn > 0 ? 0 : 1
    levelGain.gain.value = level
    const source = context.createBufferSource()
    source.buffer = decoded.get(url)!
    source.loop = loop
    source.connect(fade)
    fade.connect(levelGain)
    levelGain.connect(context.destination)
    source.start(0, 0)
    if (fadeIn > 0) ramp(fade, 1, fadeIn)
    const voice = { source, fade, level: levelGain }
    // A clip that has played out is forgotten, so a long session does not collect them.
    source.onended = () => forget(voice)
    return voice
  }
  const end = (voice: Voice, fadeOut: number) => {
    if (fadeOut > 0) {
      ramp(voice.fade, 0, fadeOut)
      voice.source.stop(ctx!.currentTime + fadeOut)
    } else voice.source.stop()
  }

  /** The level a row's gain should have: its level, silent when it is not heard. */
  const rowLevel = (index: number) =>
    audible(rowKey(index), mix.muted, mix.soloed) ? (live?.rows[index]?.level ?? 0) : 0
  const musicLevel = () =>
    audible(MUSIC_KEY, mix.muted, mix.soloed) ? (live?.music.level ?? 0) : 0

  const act = (cues: Cue[]) => {
    for (const cue of cues) {
      if (cue.kind === 'stop') {
        for (const voice of voices.get(cue.slot) ?? [])
          end(voice, cue.fade ? STATE_FADE_SECONDS : 0)
        voices.delete(cue.slot)
        continue
      }
      const index = slots.indexOf(cue.slot)
      const row = live?.rows[index]
      if (!row || ready(row.url) === null) continue
      const voice = sound(row.url!, cue.loop, rowLevel(index), cue.fade ? STATE_FADE_SECONDS : 0)
      voices.set(cue.slot, [...(voices.get(cue.slot) ?? []), voice])
    }
  }

  const engineRows = (local: PlayScene): EngineRow[] =>
    local.rows.map((row) => ({
      id: row.id,
      play: row.play,
      state: row.state,
      seconds: seconds(row.url),
    }))

  /** Makes the music the scene's: another track crossfades. */
  const setMusic = () => {
    if (!live) return
    const url = ready(live.music.url)
    if (music && music.url === url) return
    const old = music
    music = null
    if (old) end(old.voice, MUSIC_CROSSFADE_SECONDS)
    if (url === null) return
    music = { url, voice: sound(url, true, musicLevel(), old ? MUSIC_CROSSFADE_SECONDS : 0) }
  }

  const tick = () => {
    if (phase !== 'playing') return
    act(engine.advance(now()))
    emit()
  }

  const silenceAll = (fade: number) => {
    for (const list of voices.values()) for (const voice of list) end(voice, fade)
    voices.clear()
    for (const voice of overs.splice(0)) end(voice, fade)
    if (music) end(music.voice, fade)
    music = null
  }

  /** Every sound takes the level it should have now, at once. */
  const applyLevels = () => {
    slots.forEach((slot, index) => {
      for (const voice of voices.get(slot) ?? []) setNow(voice.level, rowLevel(index))
    })
    if (music) setNow(music.voice.level, musicLevel())
  }

  return {
    /** Loads the scene's clips, then enters it. A second press while loading does nothing. */
    async start(first: PlayScene): Promise<void> {
      if (phase !== 'stopped') return
      const mine = ++token
      phase = 'loading'
      latest = first
      emit()
      ctx ??= web.context()
      await ctx.resume?.()
      // Edits made while loading are loaded too: what the page has when the clips are in is played.
      let loaded: PlayScene | null = null
      while (loaded !== latest) {
        loaded = latest
        await loadAll([loaded!.music.url, ...loaded!.rows.map((r) => r.url)])
        if (mine !== token) return
      }
      const entering = loaded!
      engine = createSceneEngine({ random: web.random })
      live = entering
      const rows = engineRows(entering)
      slots = rows.map((_, i) => i)
      t0 = ctx.currentTime
      const cues = engine.enter(rows, entering.state, 0)
      phase = 'playing'
      setMusic()
      act(cues)
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
      live = null
      phase = 'stopped'
      emit()
    },

    /** The scene as the page has it now: an edit, heard at once. */
    async update(next: PlayScene): Promise<void> {
      latest = next
      if (phase !== 'playing') return
      const mine = token
      updating++
      try {
        await loadAll([next.music.url, ...next.rows.map((r) => r.url)])
        // A newer edit is on its way (or applied): this one is stale.
        if (mine !== token || latest !== next) return
        const t = now()
        const stateChanged = next.state !== live?.state
        if (stateChanged) act(engine.setState(next.state, t))
        const change = engine.setRows(engineRows(next), t)
        act(change.cues.filter((c) => c.kind === 'stop'))
        live = next
        slots = change.slots
        act(change.cues.filter((c) => c.kind === 'start'))
        setMusic()
        applyLevels()
        emit()
      } finally {
        updating--
      }
    },

    /** Mute and solo changed: each sound fades to its level, or to silence. */
    setMix(next: MixSets): void {
      mix = next
      if (phase !== 'playing' || updating > 0) return
      slots.forEach((slot, index) => {
        for (const voice of voices.get(slot) ?? [])
          ramp(voice.level, rowLevel(index), STATE_FADE_SECONDS)
      })
      if (music) ramp(music.voice.level, musicLevel(), STATE_FADE_SECONDS)
    },

    /** A level changed: heard at once. */
    setLevel(): void {
      if (phase === 'playing' && live) applyLevels()
    },

    /** The scene's state becomes `state`. */
    setState(state: string | null): void {
      if (latest && latest.state !== state) latest = { ...latest, state }
      if (phase === 'playing' && live) {
        act(engine.setState(state, now()))
        live = { ...live, state }
      }
      emit()
    },

    /** The game fires `trigger`. */
    fire(trigger: string): void {
      if (phase === 'playing') act(engine.fire(trigger, now()))
      emit()
    },

    /** Plays one clip over the scene at `level`, whatever mute and solo say; ■ ends it too. */
    async once(url: string, level: number): Promise<void> {
      const mine = token
      await loadAll([url])
      if (mine !== token || phase !== 'playing' || ready(url) === null) return
      overs.push(sound(url, false, level, 0))
    },

    /** The current view. */
    view,
  }
}
