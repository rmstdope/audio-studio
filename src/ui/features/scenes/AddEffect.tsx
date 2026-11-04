import { useEffect, useRef, useState } from 'react'
import type { SceneEffectChoice } from '../../../core/scenes'
import { PlayIcon, StopIcon } from '../../components/icons'
import type { ScenePlayer } from './SceneDetail'

/**
 * "+ Add a sound effect": a menu under the button, drawn in front of the scene's play bar, with a
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

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
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
        <div className="menu-list scene-add-list" role="dialog" aria-label="Add a sound effect">
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
