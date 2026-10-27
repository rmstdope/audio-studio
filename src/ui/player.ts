/** A clip to play: an id to tell it by, and where it is. */
export interface Clip {
  id: string
  url: string
  /** Fade it in and out (a take); the game's file and narration play as they are. */
  fade?: boolean
}

/** The part of an audio element the player uses, so tests can give a fake one. */
export interface AudioLike {
  src: string
  currentTime: number
  volume?: number
  duration?: number
  play(): Promise<void>
  pause(): void
}

/** How long a take fades in and out when played in the studio, in seconds. */
export const TAKE_FADE_SECONDS = 0.2

/** A clock the fade runs on: the time in milliseconds, and a repeating call that can be cancelled. */
export interface Clock {
  now(): number
  every(fn: () => void): () => void
}

/** The browser's clock: `performance.now` and a 16 ms interval. */
const browserClock: Clock = {
  now: () => performance.now(),
  every(fn) {
    const id = setInterval(fn, 16)
    return () => clearInterval(id)
  },
}

/** What the player is doing: the clip playing (or null), and whether it plays a list. */
export interface PlayerState {
  playing: string | null
  inTurn: boolean
}

/**
 * Plays clips on one audio element, one at a time: a single clip, or a list in turn (a clip that
 * fails is skipped). The element's `ended` and `error` events are passed on as `ended()` and
 * `failed()`. A failure can be told twice (the error event, then the rejected `play()`); each
 * play has a token, and only the play still current is acted on, so a clip is skipped once and a
 * play replaced meanwhile is let be. `onChange` hears every change of state, `onFailed` the id of
 * each clip that failed; `dispose` ends it.
 *
 * With `options.fadeSeconds` every clip fades in, fades out before its natural end, and a stop
 * (or another clip started) fades it out before the element pauses; the state still changes at
 * once. Without it the element's volume is never touched.
 */
export function createPlayer(
  element: AudioLike,
  onChange: (state: PlayerState) => void,
  onFailed: (id: string) => void = () => {},
  options: { fadeSeconds?: number; clock?: Clock } = {},
) {
  const fadeMs = (options.fadeSeconds ?? 0) * 1000
  const clock = options.clock ?? browserClock
  // Fade state: when the clip began, when its fade-out began (null: not stopping), the clip to
  // start once that fade-out is over, whether the element is making sound, and the ticker's end.
  let startedAt = 0
  let outSince: number | null = null
  let outFrom = 1
  let afterOut: (() => void) | null = null
  let audible = false
  let cancelTick: (() => void) | null = null

  let queue: Clip[] = []
  let current: string | null = null
  let token = 0
  // Once disposed (its page left), the player starts nothing again.
  let disposed = false

  const emit = () => onChange({ playing: current, inTurn: queue.length > 0 })

  /** The volume now: the lowest of the fade-in, the approach of the end, and the fade-out. */
  const level = () => {
    const t = clock.now()
    let gain = (t - startedAt) / fadeMs
    const length = element.duration
    if (length !== undefined && Number.isFinite(length)) {
      gain = Math.min(gain, ((length - element.currentTime) * 1000) / fadeMs)
    }
    if (outSince !== null) gain = Math.min(gain, outFrom * (1 - (t - outSince) / fadeMs))
    return Math.max(0, Math.min(1, gain))
  }

  const endTicker = () => {
    cancelTick?.()
    cancelTick = null
  }

  /** The element makes no sound any more: nothing to fade. Returns the clip waiting, if any. */
  const silent = () => {
    endTicker()
    audible = false
    outSince = null
    const next = afterOut
    afterOut = null
    return next
  }

  const tick = () => {
    element.volume = level()
    if (outSince !== null && clock.now() - outSince >= fadeMs) {
      element.pause()
      silent()?.()
    }
  }

  /** Begins to fade the sound out; `then` runs when it is over. */
  const fadeOut = (then: (() => void) | null) => {
    afterOut = then
    if (outSince === null) {
      outFrom = level()
      outSince = clock.now()
    }
  }

  const begin = (clip: Clip) => {
    const mine = ++token
    element.src = clip.url
    element.currentTime = 0
    current = clip.id
    if (fadeMs > 0) {
      endTicker()
      outSince = null
      if (clip.fade) {
        element.volume = 0
        startedAt = clock.now()
        audible = true
        cancelTick = clock.every(tick)
      } else {
        element.volume = 1
      }
    }
    emit()
    element.play().catch(() => fail(mine))
  }

  const start = (clip: Clip) => {
    if (disposed) return
    if (!audible) return begin(clip)
    // Something still sounds: let it fade out, then start this one.
    token++
    current = clip.id
    emit()
    fadeOut(() => begin(clip))
  }

  const stop = () => {
    token++
    queue = []
    current = null
    if (audible) fadeOut(null)
    else element.pause()
    emit()
  }

  /** The clip is over on its own: the element is silent. */
  const over = () => {
    const next = silent()
    if (next) {
      next()
      return true
    }
    return false
  }

  /** The next clip of the list, or the end. */
  const advance = () => {
    const at = queue.findIndex((c) => c.id === current)
    const clip = at >= 0 ? queue[at + 1] : undefined
    if (clip) start(clip)
    else stop()
  }

  const fail = (of: number) => {
    if (of !== token) return
    silent()
    if (current !== null) onFailed(current)
    advance()
  }

  return {
    /** Plays a clip on its own, or stops it if it is the one playing. */
    toggle(id: string, url: string, how: { fade?: boolean } = {}) {
      if (current === id) return stop()
      queue = []
      start({ id, url, ...how })
    },
    /** Plays the clips one after another. */
    playInTurn(clips: Clip[]) {
      if (!clips.length) return
      queue = clips
      start(clips[0]!)
    },
    /** Stops whatever plays, a list included. */
    stop,
    /** The clip playing has ended. */
    ended() {
      if (!over()) advance()
    },
    /** The clip playing could not be played. */
    failed() {
      // An old take that errs while it fades out for the next: its fade is over, nothing more.
      if (outSince !== null) silent()?.()
      else fail(token)
    },
    /** Stops for good: the page is left, and nothing the element says after starts a clip. */
    dispose() {
      stop()
      silent()
      element.pause()
      disposed = true
    },
  }
}
