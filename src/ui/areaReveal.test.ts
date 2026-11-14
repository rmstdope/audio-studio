import { describe, expect, it } from 'bun:test'
import { clampToWindow, revealDelta } from './areaReveal'

describe('revealDelta', () => {
  it('is 0 for a box already in view below the bar', () => {
    expect(revealDelta({ top: 200, bottom: 300 }, 100, 800)).toBe(0)
  })
  it('scrolls up to show a box under the bar, leaving the gap', () => {
    expect(revealDelta({ top: 40, bottom: 90 }, 100, 800)).toBe(-68)
  })
  it('scrolls down to show a box below the window, leaving the gap', () => {
    expect(revealDelta({ top: 850, bottom: 950 }, 100, 800)).toBe(158)
  })
  it('does not move for a box partly in view, however much sticks out', () => {
    expect(revealDelta({ top: 500, bottom: 1500 }, 100, 800)).toBe(0)
    expect(revealDelta({ top: 50, bottom: 1500 }, 100, 800)).toBe(0)
    expect(revealDelta({ top: 790, bottom: 900 }, 100, 800)).toBe(0)
  })
  it('shows the top of a box wholly out of sight and taller than the room', () => {
    expect(revealDelta({ top: -900, bottom: 50 }, 100, 800)).toBe(-1008)
    expect(revealDelta({ top: 900, bottom: 2500 }, 100, 800)).toBe(792)
  })
})

describe('clampToWindow', () => {
  it('keeps a point inside the window', () => {
    expect(clampToWindow({ x: -5, y: 900 }, { width: 1000, height: 800 })).toEqual({ x: 0, y: 800 })
    expect(clampToWindow({ x: 10, y: 20 }, { width: 1000, height: 800 })).toEqual({ x: 10, y: 20 })
  })
  it('keeps it below the pinned bar when given one', () => {
    expect(clampToWindow({ x: 10, y: 20 }, { width: 1000, height: 800 }, 100)).toEqual({
      x: 10,
      y: 100,
    })
  })
})
