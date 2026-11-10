import { describe, expect, it } from 'bun:test'
import { closeUp, closeUpLayer } from './patchCloseUp'

const take = { width: 256, height: 200 }

describe('closeUp', () => {
  it('takes a quarter of the area’s sides around it', () => {
    expect(closeUp({ x: 100, y: 80, width: 80, height: 40 }, take)).toEqual({
      x: 80,
      y: 70,
      width: 120,
      height: 60,
    })
  })

  it('stops at the picture’s edges and keeps what is left, heightened to the widest shape', () => {
    expect(closeUp({ x: 0, y: 0, width: 80, height: 40 }, take)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    })
    expect(closeUp({ x: 200, y: 180, width: 56, height: 20 }, take)).toEqual({
      x: 186,
      y: 172,
      width: 70,
      height: 28,
    })
  })

  it('whole pixels, so a layer lines up', () => {
    const crop = closeUp({ x: 33, y: 33, width: 25, height: 25 }, take)
    expect(Object.values(crop).every(Number.isInteger)).toBe(true)
  })
})

describe('closeUp with what a take keeps', () => {
  const big = { width: 1000, height: 800 }
  const mark = { x: 400, y: 400, width: 100, height: 100 }

  it('is the mark’s frame when nothing is kept or the change is inside the mark', () => {
    const today = closeUp(mark, big)
    expect(closeUp(mark, big, null)).toEqual(today)
    expect(closeUp(mark, big, { x: 420, y: 420, width: 20, height: 20 })).toEqual(today)
  })

  it('joins the mark and the change, with a quarter of the joined box round it', () => {
    // Change 100 wide, 200 tall, from 100 above the mark to its bottom: joined (400, 300, 100, 200).
    const crop = closeUp(mark, big, { x: 400, y: 300, width: 100, height: 200 })
    // A quarter more on each side is 150 x 300 (twice as tall as wide), widened to 200 round its middle.
    expect(crop).toEqual({ x: 350, y: 250, width: 200, height: 300 })
  })

  it('never makes a frame taller than 1.5 times its width, widening round the change', () => {
    const crop = closeUp(mark, big, { x: 440, y: 200, width: 20, height: 300 })
    expect(crop.height / crop.width).toBeLessThanOrEqual(1.5)
    // Still holds the whole change and the mark.
    expect(crop.x).toBeLessThanOrEqual(400)
    expect(crop.x + crop.width).toBeGreaterThanOrEqual(500)
    expect(crop.y).toBeLessThanOrEqual(200)
    expect(crop.y + crop.height).toBeGreaterThanOrEqual(500)
  })

  it('never makes a frame wider than 2.5 times its height', () => {
    const crop = closeUp(mark, big, { x: 100, y: 440, width: 800, height: 20 })
    expect(crop.width / crop.height).toBeLessThanOrEqual(2.5)
    expect(crop.y).toBeLessThanOrEqual(400)
    expect(crop.y + crop.height).toBeGreaterThanOrEqual(500)
  })

  it('moves the widened frame inward at the picture’s edge', () => {
    // Joined (0, 100, 20, 400) plus a quarter: 30 x 600 at x 0; widened to 400, centred at 15 and moved inward.
    expect(
      closeUp({ x: 0, y: 400, width: 20, height: 20 }, big, {
        x: 0,
        y: 100,
        width: 20,
        height: 400,
      }),
    ).toEqual({ x: 0, y: 0, width: 400, height: 600 })
    // At the right edge it moves inward the other way.
    expect(
      closeUp({ x: 980, y: 400, width: 20, height: 20 }, big, {
        x: 980,
        y: 100,
        width: 20,
        height: 400,
      }),
    ).toEqual({ x: 600, y: 0, width: 400, height: 600 })
  })

  it('stops at the picture when it is too small for the usual shape', () => {
    const tiny = { width: 100, height: 400 }
    const crop = closeUp({ x: 40, y: 100, width: 20, height: 200 }, tiny, null)
    expect(crop.x).toBe(0)
    expect(crop.width).toBe(100)
  })

  it('frames a change filling the whole window, inside the picture', () => {
    const crop = closeUp(mark, big, { x: 0, y: 0, width: 1000, height: 800 })
    expect(crop).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
  })

  it('whole pixels', () => {
    const crop = closeUp(mark, big, { x: 433, y: 211, width: 17, height: 301 })
    expect(Object.values(crop).every(Number.isInteger)).toBe(true)
  })
})

describe('closeUpLayer', () => {
  it('sizes and places the whole picture so that only the close-up shows in the frame', () => {
    expect(closeUpLayer({ x: 50, y: 20, width: 100, height: 50 }, take)).toEqual({
      width: '256%',
      height: '400%',
      left: '-50%',
      top: '-40%',
    })
  })

  it('shows the whole picture for an area that lies wholly outside it', () => {
    expect(
      closeUp({ x: -300, y: 10, width: 100, height: 100 }, { width: 640, height: 400 }),
    ).toEqual({ x: 0, y: 0, width: 640, height: 400 })
  })
})
