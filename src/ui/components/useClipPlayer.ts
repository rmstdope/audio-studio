import { useCallback, useEffect, useRef, useState } from 'react'
import { afterInTurn } from '../inGame'

/** A clip to play: an id to tell it by, and where it is. */
export interface Clip {
  id: string
  url: string
}

/**
 * One clip playing at a time: `toggle(id, url)` plays it, or stops it if it is the one playing.
 * `playInTurn(clips)` plays clips one after another (any toggle stops that). `playing` is the id
 * of the clip playing, or null; `inTurn` says whether a list is being played.
 */
export function useClipPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [inTurn, setInTurn] = useState(false)
  // The list played in turn, and the clip playing, for the `ended` handler to go on from.
  const queue = useRef<Clip[]>([])
  const current = useRef<string | null>(null)

  const start = useCallback((element: HTMLAudioElement, clip: Clip) => {
    element.src = clip.url
    element.currentTime = 0
    current.current = clip.id
    setPlaying(clip.id)
    element.play().catch(() => stopAll())
  }, [])

  const stopAll = () => {
    queue.current = []
    current.current = null
    setInTurn(false)
    setPlaying(null)
  }

  useEffect(() => {
    const element = new Audio()
    const ended = () => {
      const ids = queue.current.map((c) => c.id)
      const next = current.current ? afterInTurn(ids, current.current) : null
      const clip = next ? queue.current.find((c) => c.id === next) : undefined
      if (clip) start(element, clip)
      else stopAll()
    }
    element.addEventListener('ended', ended)
    element.addEventListener('error', ended)
    audio.current = element
    return () => {
      element.pause()
      element.removeEventListener('ended', ended)
      element.removeEventListener('error', ended)
    }
  }, [start])

  const toggle = useCallback(
    (id: string, url: string) => {
      const element = audio.current
      if (!element) return
      queue.current = []
      setInTurn(false)
      if (playing === id) {
        element.pause()
        current.current = null
        setPlaying(null)
        return
      }
      start(element, { id, url })
    },
    [playing, start],
  )

  const playInTurn = useCallback(
    (clips: Clip[]) => {
      const element = audio.current
      if (!element || !clips.length) return
      queue.current = clips
      setInTurn(true)
      start(element, clips[0]!)
    },
    [start],
  )

  /** Stops whatever is playing, a list included. */
  const stop = useCallback(() => {
    audio.current?.pause()
    stopAll()
  }, [])

  return { playing, toggle, playInTurn, inTurn, stop }
}
