import type { AudioLike } from './player'

/** A decoded clip: only its length is read here. */
export interface LoopBuffer {
  duration: number
}

/** The part of a Web Audio source node a loop uses. */
interface LoopSource {
  buffer: LoopBuffer | null
  loop: boolean
  connect(node: unknown): unknown
  onended: ((event: Event) => void) | null
  start(when: number, offset: number): void
  stop(when?: number): void
}

/** The part of a Web Audio gain node a loop uses. */
interface LoopGain {
  gain: { value: number }
  connect(node: unknown): unknown
}

/** The part of the Web Audio API a loop uses, so tests can give a fake one. */
export interface LoopContext {
  currentTime: number
  destination: unknown
  resume?(): Promise<void>
  decodeAudioData(data: ArrayBuffer): Promise<LoopBuffer>
  createBufferSource(): LoopSource
  createGain(): LoopGain
}

/** How far into a loop of `duration` seconds the playhead is, begun at `offset` at `startedAt`. */
export function loopTime(now: number, startedAt: number, offset: number, duration: number): number {
  return (now - startedAt + offset) % duration
}

/**
 * One audio element for the player that plays a loop without a gap: an audio element restarts a
 * loop with a short break, heard as a click where it comes round, so a clip with `loop` set is
 * decoded once and played round and round on Web Audio, sample for sample. Every other clip plays
 * on `element`. `web.context` is asked for the first time a loop plays (a browser lets audio start
 * only from a press); `web.playing` is told when a loop sounds, as the element's playing event is.
 * A loop with `rounds` stops after that many rounds, counted from where it began, and `web.ended`
 * is told, as the element's ended event is; a loop that is stopped says nothing.
 */
export function createClipAudio(
  element: AudioLike,
  web: {
    context: () => LoopContext
    load: (url: string) => Promise<ArrayBuffer>
    playing: () => void
    ended: () => void
  },
): AudioLike & { loop: boolean } {
  let src = ''
  let loop = false
  let rounds: number | undefined
  let offset = 0
  let volume = 1
  let using: 'element' | 'web' | null = null
  let context: LoopContext | null = null
  const buffers = new Map<string, Promise<LoopBuffer>>()
  let buffer: LoopBuffer | null = null
  let source: LoopSource | null = null
  let gain: LoopGain | null = null
  let startedAt = 0
  // Each play of a loop has a token: one paused while it was still loading never starts.
  let token = 0

  const stopWeb = () => {
    if (source) source.onended = null
    source?.stop()
    source = null
    gain = null
  }

  const playLoop = async (url: string) => {
    const mine = ++token
    context ??= web.context()
    const ctx = context
    await ctx.resume?.()
    let decoding = buffers.get(url)
    if (!decoding) {
      decoding = web.load(url).then((data) => ctx.decodeAudioData(data))
      buffers.set(url, decoding)
      // A clip that could not be loaded is tried again the next time.
      decoding.catch(() => buffers.delete(url))
    }
    const decoded = await decoding
    if (mine !== token) return
    buffer = decoded
    gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(ctx.destination)
    source = ctx.createBufferSource()
    source.buffer = decoded
    source.loop = true
    source.connect(gain)
    const from = decoded.duration > 0 ? offset % decoded.duration : 0
    source.start(0, from)
    if (rounds !== undefined) {
      const mine = source
      mine.onended = () => {
        if (source === mine) web.ended()
      }
      mine.stop(ctx.currentTime + rounds * decoded.duration - from)
    }
    startedAt = ctx.currentTime
    offset = from
    web.playing()
  }

  return {
    get src() {
      return src
    },
    set src(url: string) {
      src = url
    },
    get loop() {
      return loop
    },
    set loop(value: boolean) {
      loop = value
    },
    get rounds() {
      return rounds
    },
    set rounds(value: number | undefined) {
      rounds = value
    },
    get currentTime() {
      if (using === 'element') return element.currentTime
      if (source && context && buffer && buffer.duration > 0) {
        return loopTime(context.currentTime, startedAt, offset, buffer.duration)
      }
      return offset
    },
    set currentTime(seconds: number) {
      offset = seconds
      if (using === 'element') element.currentTime = seconds
    },
    get volume() {
      return volume
    },
    set volume(value: number) {
      volume = value
      if (using === 'element') element.volume = value
      if (gain) gain.gain.value = value
    },
    get duration() {
      if (using === 'web') return buffer?.duration ?? Number.NaN
      return element.duration ?? Number.NaN
    },
    play() {
      token++
      stopWeb()
      if (loop) {
        if (using === 'element') element.pause()
        using = 'web'
        buffer = null
        return playLoop(src)
      }
      using = 'element'
      element.src = src
      element.currentTime = offset
      element.volume = volume
      return element.play()
    },
    pause() {
      token++
      if (using === 'element') element.pause()
      stopWeb()
    },
  }
}
