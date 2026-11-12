import { describe, expect, it } from 'bun:test'
import { scrollWithin } from './scrollWithin'

const at = (left: number, right: number, top = 0, bottom = 10) => ({
  getBoundingClientRect: () => ({ left, right, top, bottom }),
})
const box = () => ({ ...at(0, 300, 0, 100), scrollLeft: 50, scrollTop: 20 })

describe('scrolling one box to an item inside it', () => {
  it('leaves the box alone when the item is in view', () => {
    const b = box()
    scrollWithin(at(10, 150), b)
    expect([b.scrollLeft, b.scrollTop]).toEqual([50, 20])
  })

  it('scrolls back to an item cut off at the start, and on to one cut off at the end', () => {
    const b = box()
    scrollWithin(at(-30, 110), b)
    expect(b.scrollLeft).toBe(20)
    scrollWithin(at(250, 390), b)
    expect(b.scrollLeft).toBe(110)
  })

  it('scrolls down and up in a grid', () => {
    const b = box()
    scrollWithin(at(0, 100, 80, 140), b)
    expect(b.scrollTop).toBe(60)
    scrollWithin(at(0, 100, -15, 45), b)
    expect(b.scrollTop).toBe(45)
  })

  it('lines up the start of an item wider than the box', () => {
    const b = box()
    scrollWithin(at(40, 500), b)
    expect(b.scrollLeft).toBe(90)
  })

  it('does nothing without an item or a box', () => {
    const b = box()
    scrollWithin(undefined, b)
    scrollWithin(at(-30, 110), null)
    expect(b.scrollLeft).toBe(50)
  })
})
