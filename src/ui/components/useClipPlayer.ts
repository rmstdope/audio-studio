import { useEffect, useMemo, useRef, useState } from 'react'
import { createPlayer, type Clip, type PlayerState } from '../player'

export type { Clip }

/**
 * One clip playing at a time (see `createPlayer`): `toggle(id, url)` plays it, or stops it if it
 * is the one playing; `playInTurn(clips)` plays clips one after another, skipping one that fails
 * (any toggle stops that). `playing` is the id of the clip playing, or null; `inTurn` says
 * whether a list is being played.
 */
export function useClipPlayer() {
  const [state, setState] = useState<PlayerState>({ playing: null, inTurn: false })
  const player = useRef<ReturnType<typeof createPlayer> | null>(null)

  useEffect(() => {
    const element = new Audio()
    const made = createPlayer(element, setState)
    const ended = () => made.ended()
    const failed = () => made.failed()
    element.addEventListener('ended', ended)
    element.addEventListener('error', failed)
    player.current = made
    return () => {
      element.pause()
      element.removeEventListener('ended', ended)
      element.removeEventListener('error', failed)
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
