import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One clip playing at a time: `toggle(id, url)` plays it, or stops it if it is the one playing.
 * `playing` is the id of the clip playing, or null.
 */
export function useClipPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    const element = new Audio()
    const stop = () => setPlaying(null)
    element.addEventListener('ended', stop)
    element.addEventListener('error', stop)
    audio.current = element
    return () => {
      element.pause()
      element.removeEventListener('ended', stop)
      element.removeEventListener('error', stop)
    }
  }, [])

  const toggle = useCallback(
    (id: string, url: string) => {
      const element = audio.current
      if (!element) return
      if (playing === id) {
        element.pause()
        setPlaying(null)
        return
      }
      element.src = url
      element.currentTime = 0
      setPlaying(id)
      element.play().catch(() => setPlaying(null))
    },
    [playing],
  )

  return { playing, toggle }
}
