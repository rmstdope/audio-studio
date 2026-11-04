import { describe, expect, it } from 'bun:test'
import { placeMenu } from './menuPlacement'

// A 800 px window, a button spanning 400-430, so 366 px below and 396 px above (4 px gaps).
const base = { buttonTop: 400, buttonBottom: 430, viewportHeight: 800 }

describe('placeMenu', () => {
  it('opens below when the whole menu fits there', () => {
    expect(placeMenu({ ...base, menuHeight: 300 })).toEqual({ side: 'below', fit: null })
  })

  it('counts the 4 px gap: a menu exactly as tall as the room below still fits', () => {
    expect(placeMenu({ ...base, menuHeight: 366 })).toEqual({ side: 'below', fit: null })
    expect(placeMenu({ ...base, menuHeight: 367 }).side).toBe('above')
  })

  it('opens above when it does not fit below but fits above', () => {
    expect(placeMenu({ ...base, menuHeight: 390 })).toEqual({ side: 'above', fit: null })
  })

  it('opens on the side with more room, shortened, when neither fits', () => {
    expect(placeMenu({ ...base, menuHeight: 500 })).toEqual({ side: 'above', fit: 396 })
    expect(
      placeMenu({ buttonTop: 100, buttonBottom: 130, viewportHeight: 600, menuHeight: 800 }),
    ).toEqual({ side: 'below', fit: 466 })
  })

  it('keeps the side it was given, only shortening to fit', () => {
    expect(placeMenu({ ...base, menuHeight: 300, keepSide: 'above' })).toEqual({
      side: 'above',
      fit: null,
    })
    expect(placeMenu({ ...base, menuHeight: 500, keepSide: 'below' })).toEqual({
      side: 'below',
      fit: 366,
    })
  })
})
