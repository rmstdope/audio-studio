import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { placeMenu } from '../../../core/menuPlacement'
import type { SceneEffectChoice } from '../../../core/scenes'
import { PlayIcon, StopIcon } from '../../components/icons'
import type { ScenePlayer } from './SceneDetail'

/**
 * "+ Add a sound effect": a menu under the button (above it when it does not fit below, and with a
 * shorter list when it fits neither), drawn in front of the scene's play bar, with a
 * box that narrows the game's sound effects as you type; every match is listed, and the list
 * scrolls. Each has ▶ to hear it, "loop" beside loops and "no take chosen" beside the silent;
 * clicking one adds it.
 */
export function AddEffect({
  choices,
  player,
  onAdd,
}: {
  choices: SceneEffectChoice[]
  player: ScenePlayer
  onAdd: (choice: SceneEffectChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<'below' | 'above'>('below')
  // The side chosen when the menu opened; typing keeps it, a resize or scroll chooses again.
  const chosen = useRef<'below' | 'above' | null>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  const place = (keep: boolean) => {
    const el = menu.current
    const list = el?.querySelector('ul')
    const btn = button.current
    if (!el || !list || !btn) return
    list.style.maxHeight = ''
    const rect = btn.getBoundingClientRect()
    const height = el.offsetHeight
    const { side: next, fit } = placeMenu({
      buttonTop: rect.top,
      buttonBottom: rect.bottom,
      viewportHeight: window.innerHeight,
      menuHeight: height,
      keepSide: keep ? (chosen.current ?? undefined) : undefined,
    })
    chosen.current = next
    setSide(next)
    if (fit !== null) list.style.maxHeight = `${Math.max(48, list.offsetHeight - (height - fit))}px`
  }
  const placeRef = useRef(place)
  placeRef.current = place
  const typing = useRef(false)
  useLayoutEffect(() => {
    if (!open) {
      chosen.current = null
      return
    }
    placeRef.current(typing.current)
    typing.current = true
  }, [open, query])
  useEffect(() => {
    if (!open) {
      typing.current = false
      return
    }
    const again = () => placeRef.current(false)
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
    }
  }, [open])

  const words = query.trim().toLowerCase()
  const matches = choices.filter(
    (c) => c.id.toLowerCase().includes(words) || c.name.toLowerCase().includes(words),
  )
  const close = () => {
    setOpen(false)
    setQuery('')
    button.current?.focus()
  }
  return (
    <div
      className="scene-add-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="btn"
        data-add
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        + Add a sound effect
      </button>
      {open && (
        <div
          ref={menu}
          className={
            side === 'above' ? 'menu-list scene-add-list scene-add-up' : 'menu-list scene-add-list'
          }
          role="dialog"
          aria-label="Add a sound effect"
        >
          <input
            type="text"
            autoFocus
            placeholder="Find a sound effect…"
            aria-label="Find a sound effect…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul>
            {matches.map((choice) => {
              const playing = player.playing === `add-${choice.id}`
              return (
                <li key={choice.id}>
                  {choice.playable ? (
                    <button
                      type="button"
                      className={playing ? 'icon-btn music-stop' : 'icon-btn'}
                      aria-label={playing ? `Stop ${choice.name}` : `Play ${choice.name}`}
                      onClick={() =>
                        player.toggle(
                          `add-${choice.id}`,
                          `/api/effects/${encodeURIComponent(choice.id)}/current`,
                          { level: 1, loop: choice.loops },
                        )
                      }
                    >
                      {playing ? <StopIcon /> : <PlayIcon />}
                    </button>
                  ) : (
                    <span className="scene-play" />
                  )}
                  <button
                    type="button"
                    className="menu-option"
                    onClick={() => {
                      player.stop()
                      onAdd(choice)
                      close()
                    }}
                  >
                    <span className="mono">{choice.id}</span>
                    {choice.loops && <span className="chip">loop</span>}
                    {choice.silent && <span className="chip chip-warn">no take chosen</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
