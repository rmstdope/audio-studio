import { useEffect, useRef, useState } from 'react'
import type { LoopContext } from './loopAudio'

/** What a scene clip plays on: a Web Audio context, and how to fetch a clip. */
export interface SceneClipWeb {
  context: () => LoopContext
  load: (url: string) => Promise<ArrayBuffer>
}

/**
 * One clip at a time, played alone at its level (0 to 3, 1 as made: above 1 the sound is raised
 * with a gain, which an audio element's volume cannot do). `toggle` plays a clip, or stops it if it
 * is the one playing; starting another stops the first. `onChange` hears the id of the clip playing,
 * or null when none is: at once on a press, and when a clip ends or cannot be loaded. A loop plays
 * until stopped.
 */
export function createSceneClip(
  web: SceneClipWeb,
  onChange: (playing: string | null) => void,
): {
  toggle: (id: string, url: string, how: { level: number; loop?: boolean }) => void
  /** Sets the level of the clip `id` if it is the one playing (or loading): heard at once. */
  setLevel: (id: string, level: number) => void
  stop: () => void
} {
  let context: LoopContext | null = null
  let playing: string | null = null
  let source: ReturnType<LoopContext['createBufferSource']> | null = null
  let gainNode: { gain: { value: number } } | null = null
  // The level of the clip playing or loading, which a slider may change meanwhile.
  let level = 1
  // A press that is still loading is dropped when the next press or a stop comes.
  let token = 0
  const buffers = new Map<string, Promise<Awaited<ReturnType<LoopContext['decodeAudioData']>>>>()

  const set = (id: string | null) => {
    playing = id
    onChange(id)
  }
  const halt = () => {
    token++
    gainNode = null
    if (source) source.onended = null
    source?.stop()
    source = null
  }
  const stop = () => {
    halt()
    if (playing !== null) set(null)
  }

  const start = async (id: string, url: string, loop: boolean) => {
    const mine = token
    try {
      context ??= web.context()
      const ctx = context
      await ctx.resume?.()
      let decoding = buffers.get(url)
      if (!decoding) {
        decoding = web.load(url).then((data) => ctx.decodeAudioData(data))
        buffers.set(url, decoding)
        decoding.catch(() => buffers.delete(url))
      }
      const buffer = await decoding
      if (mine !== token) return
      const gain = ctx.createGain()
      gain.gain.value = level
      gainNode = gain
      gain.connect(ctx.destination)
      const made = ctx.createBufferSource()
      made.buffer = buffer
      made.loop = loop
      made.connect(gain)
      made.onended = () => {
        if (source === made) {
          source = null
          set(null)
        }
      }
      source = made
      made.start(0, 0)
    } catch {
      if (mine === token && playing === id) set(null)
    }
  }

  return {
    toggle(id, url, how) {
      const loop = how.loop ?? false
      if (playing === id) return stop()
      halt()
      level = how.level
      set(id)
      void start(id, url, loop)
    },
    setLevel(id, next) {
      if (playing !== id) return
      level = next
      if (gainNode) gainNode.gain.value = next
    },
    stop,
  }
}

/** `createSceneClip` for a component: `playing` is the id of the clip playing, or null; stops when the page is left. */
export function useSceneClip() {
  const [playing, setPlaying] = useState<string | null>(null)
  const clip = useRef<ReturnType<typeof createSceneClip> | null>(null)
  clip.current ??= createSceneClip(
    {
      context: () => new AudioContext(),
      load: async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`${url} could not be loaded`)
        return response.arrayBuffer()
      },
    },
    setPlaying,
  )
  useEffect(() => () => clip.current?.stop(), [])
  return {
    playing,
    toggle: clip.current.toggle,
    setLevel: clip.current.setLevel,
    stop: clip.current.stop,
  }
}
