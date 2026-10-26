import { useEffect, useMemo, useRef, useState } from 'react'
import { createPlayer, type Clip, type PlayerState } from '../player'

/**
 * One clip playing at a time (see `createPlayer`): `toggle(id, url)` plays it, or stops it if it
 * is the one playing; `playInTurn(clips)` plays clips one after another, skipping one that fails
 * (any toggle stops that). `onFailed` hears the id of a clip that failed. `playing` is the id of the clip playing, or null; `inTurn` says
 * whether a list is being played.
 */
export function useClipPlayer(onFailed?: (id: string) => void) {
  const [state, setState] = useState<PlayerState>({ playing: null, inTurn: false })
  const player = useRef<ReturnType<typeof createPlayer> | null>(null)
  const failed = useRef(onFailed)
  failed.current = onFailed

  useEffect(() => {
    const element = new Audio()
    const made = createPlayer(element, setState, (id) => failed.current?.(id))
    element.addEventListener('ended', made.ended)
    element.addEventListener('error', made.failed)
    player.current = made
    return () => {
      // Disposed, not just paused: a play still loading must not start the next clip.
      made.dispose()
      element.removeEventListener('ended', made.ended)
      element.removeEventListener('error', made.failed)
      player.current = null
    }
  }, [])

  // The same functions on every render; they reach the player made on mount.
  const actions = useMemo(
    () => ({
      toggle: (id: string, url: string) => player.current?.toggle(id, url),
      playInTurn: (clips: Clip[]) => player.current?.playInTurn(clips),
      stop: () => player.current?.stop(),
    }),
    [],
  )
  return { ...state, ...actions }
}
