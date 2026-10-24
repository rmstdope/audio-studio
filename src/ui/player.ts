import { afterInTurn } from './inGame'

/** A clip to play: an id to tell it by, and where it is. */
export interface Clip {
  id: string
  url: string
}

/** The part of an audio element the player uses, so tests can give a fake one. */
export interface AudioLike {
  src: string
  currentTime: number
  play(): Promise<void>
  pause(): void
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
 * play replaced meanwhile is let be. `onChange` hears every change of state.
 */
export function createPlayer(element: AudioLike, onChange: (state: PlayerState) => void) {
  let queue: Clip[] = []
  let current: string | null = null
  let token = 0

  const emit = () => onChange({ playing: current, inTurn: queue.length > 0 })

  const start = (clip: Clip) => {
    const mine = ++token
    element.src = clip.url
    element.currentTime = 0
    current = clip.id
    emit()
    element.play().catch(() => fail(mine))
  }

  const stop = () => {
    token++
    queue = []
    current = null
    element.pause()
    emit()
  }

  /** The next clip of the list, or the end. */
  const advance = () => {
    const next = current
      ? afterInTurn(
          queue.map((c) => c.id),
          current,
        )
      : null
    const clip = queue.find((c) => c.id === next)
    if (clip) start(clip)
    else stop()
  }

  const fail = (of: number) => {
    if (of === token) advance()
  }

  return {
    /** Plays a clip on its own, or stops it if it is the one playing. */
    toggle(id: string, url: string) {
      if (current === id) return stop()
      queue = []
      start({ id, url })
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
    ended: advance,
    /** The clip playing could not be played. */
    failed: () => fail(token),
  }
}
