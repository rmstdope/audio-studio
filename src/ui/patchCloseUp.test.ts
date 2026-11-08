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

  it('stops at the picture’s edges and keeps what is left', () => {
    expect(closeUp({ x: 0, y: 0, width: 80, height: 40 }, take)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    })
    expect(closeUp({ x: 200, y: 180, width: 56, height: 20 }, take)).toEqual({
      x: 186,
      y: 175,
      width: 70,
      height: 25,
    })
  })

  it('whole pixels, so a layer lines up', () => {
    const crop = closeUp({ x: 33, y: 33, width: 25, height: 25 }, take)
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
