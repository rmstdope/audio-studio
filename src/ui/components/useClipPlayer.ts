import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_TAKE_FADE } from '../../core/takeFade'
import { useProject } from '../api'
import { createClipAudio } from '../loopAudio'
import { createPlayer, playedShare, type AudioLike, type Clip, type PlayerState } from '../player'

/**
 * One clip playing at a time (see `createPlayer`): `toggle(id, url)` plays it, or stops it if it
 * is the one playing; `playInTurn(clips)` plays clips one after another, skipping one that fails
 * (any toggle stops that). `onFailed` hears the id of a clip that failed. `playing` is the id of
 * the clip playing, or null; `inTurn` says whether a list is being played. `toggle(id, url, { fade: true })`
 * plays a take: it fades in and out, and a stop is a short fade, never a cut. The length is the
 * person's own `takeFade` setting (Setup's Playing takes), asked as each clip begins. With `loop: true` it
 * comes round until stopped, without a gap (`createClipAudio`). `position()` is how far into the clip playing it is, 0 to 1, or null
 * while that is not known.
 */
export function useClipPlayer(onFailed?: (id: string) => void) {
  const [state, setState] = useState<PlayerState>({ playing: null, inTurn: false })
  const player = useRef<ReturnType<typeof createPlayer> | null>(null)
  const audio = useRef<AudioLike | null>(null)
  const failed = useRef(onFailed)
  failed.current = onFailed
  const project = useProject()
  const fade = useRef(DEFAULT_TAKE_FADE)
  fade.current = project.data?.ok ? project.data.summary.takeFade : DEFAULT_TAKE_FADE

  useEffect(() => {
    const element = new Audio()
    // Set once `made` is: a loop sounds only after a press, long after this.
    let sounding = () => {}
    let finished = () => {}
    const clip = createClipAudio(element, {
      context: () => new AudioContext(),
      load: async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`${url} could not be loaded`)
        return response.arrayBuffer()
      },
      playing: () => sounding(),
      ended: () => finished(),
    })
    const made = createPlayer(clip, setState, (id) => failed.current?.(id), {
      fadeSeconds: () => fade.current,
    })
    sounding = made.playing
    finished = made.ended
    element.addEventListener('playing', made.playing)
    element.addEventListener('ended', made.ended)
    element.addEventListener('error', made.failed)
    player.current = made
    audio.current = clip
    return () => {
      // Disposed, not just paused: a play still loading must not start the next clip.
      made.dispose()
      element.removeEventListener('playing', made.playing)
      element.removeEventListener('ended', made.ended)
      element.removeEventListener('error', made.failed)
      player.current = null
      audio.current = null
    }
  }, [])

  // The same functions on every render; they reach the player made on mount.
  const actions = useMemo(
    () => ({
      toggle: (id: string, url: string, how?: { fade?: boolean; loop?: boolean }) =>
        player.current?.toggle(id, url, how),
      position: () =>
        audio.current
          ? playedShare(audio.current.currentTime, audio.current.duration ?? Number.NaN)
          : null,
      playInTurn: (clips: Clip[]) => player.current?.playInTurn(clips),
      stop: () => player.current?.stop(),
    }),
    [],
  )
  return { ...state, ...actions }
}
