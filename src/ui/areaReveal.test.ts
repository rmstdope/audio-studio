import { describe, expect, it } from 'bun:test'
import { clampToWindow, revealDelta } from './areaReveal'

describe('revealDelta', () => {
  it('is 0 for a box already in view below the bar', () => {
    expect(revealDelta({ top: 200, bottom: 300 }, 100, 800)).toBe(0)
  })
  it('scrolls up to show a box under the bar, leaving the gap', () => {
    expect(revealDelta({ top: 40, bottom: 140 }, 100, 800)).toBe(-68)
  })
  it('scrolls down to show a box below the window, leaving the gap', () => {
    expect(revealDelta({ top: 700, bottom: 900 }, 100, 800)).toBe(108)
  })
  it('shows the top of a box taller than the room', () => {
    expect(revealDelta({ top: 50, bottom: 1500 }, 100, 800)).toBe(-58)
    expect(revealDelta({ top: 500, bottom: 1500 }, 100, 800)).toBe(392)
  })
})

describe('clampToWindow', () => {
  it('keeps a point inside the window', () => {
    expect(clampToWindow({ x: -5, y: 900 }, { width: 1000, height: 800 })).toEqual({ x: 0, y: 800 })
    expect(clampToWindow({ x: 10, y: 20 }, { width: 1000, height: 800 })).toEqual({ x: 10, y: 20 })
  })
})
