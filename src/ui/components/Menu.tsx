import { useEffect, useId, useRef, useState } from 'react'

/** One thing a menu offers: the value it stands for (null: none) and the words for it. */
export interface MenuOption {
  value: string | null
  label: string
}

/**
 * A menu: a button showing the chosen value, which opens a list of what can be chosen. The arrow
 * keys move through the list, Enter or a click chooses, Escape closes and returns to the button.
 * `gone` draws the closed face in red, for a value that is no longer among the options.
 */
export function Menu({
  label,
  face,
  options,
  value,
  gone = false,
  onChange,
}: {
  /** What the menu is for, for assistive technology ("How it plays"). */
  label: string
  /** The words on the closed button. */
  face: string
  options: MenuOption[]
  value: string | null
  gone?: boolean
  onChange: (value: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    // The list opens on the chosen value, or the first.
    const all = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role=option]') ?? [])]
    ;(all.find((o) => o.getAttribute('aria-selected') === 'true') ?? all[0])?.focus()
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  const choices = () => [
    ...(root.current?.querySelectorAll<HTMLButtonElement>('[role=option]') ?? []),
  ]
  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      return close()
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    if (!open) return setOpen(true)
    const all = choices()
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    all[Math.min(all.length - 1, Math.max(0, at + step))]?.focus()
  }

  return (
    <span className="menu" ref={root} onKeyDown={keys}>
      <button
        ref={button}
        type="button"
        className={gone ? 'menu-button menu-gone' : 'menu-button'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${label}: ${face}`}
        onClick={() => setOpen(!open)}
      >
        {face}
      </button>
      {open && (
        <div className="menu-list" id={id} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value ?? ''}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'menu-option menu-current' : 'menu-option'}
              onClick={() => {
                onChange(option.value)
                close()
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
