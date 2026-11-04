/** Which side of its button a menu opens on, and the room it may take there if it must be shortened. */
export interface MenuPlacement {
  side: 'below' | 'above'
  /** The most height the whole menu may have on that side; null when its natural height fits. */
  fit: number | null
}

/**
 * Decides where a menu goes: below the button when the whole menu fits between the button and the
 * window's bottom edge, else above when it fits there, else on the side with more room, shortened.
 * `keepSide` holds the side (while typing narrows the list) and only works out the shortening.
 */
export function placeMenu(input: {
  buttonTop: number
  buttonBottom: number
  viewportHeight: number
  menuHeight: number
  gap?: number
  keepSide?: 'below' | 'above'
}): MenuPlacement {
  const gap = input.gap ?? 4
  const below = input.viewportHeight - input.buttonBottom - gap
  const above = input.buttonTop - gap
  const side =
    input.keepSide ??
    (input.menuHeight <= below
      ? 'below'
      : input.menuHeight <= above
        ? 'above'
        : below >= above
          ? 'below'
          : 'above')
  const room = side === 'below' ? below : above
  return { side, fit: input.menuHeight <= room ? null : Math.max(0, room) }
}
