import { describe, expect, it } from 'bun:test'
import { gameSpace, modelSpace } from './patchGameSpace'

describe('where a marked area falls', () => {
  const area = { x: 192, y: 64, width: 320, height: 320 }

  it('is where it was marked on what the model made', () => {
    expect(modelSpace({ width: 1024, height: 640 }).place(area)).toEqual(area)
  })

  it('moves and scales with the picture the game gets from a take of the same shape', () => {
    const space = gameSpace({ width: 1024, height: 640 }, { width: 640, height: 400 })
    expect(space).toMatchObject({ width: 640, height: 400 })
    expect(space.place(area)).toEqual({ x: 120, y: 40, width: 200, height: 200 })
  })

  it('turns an area drawn on the game’s picture back into one of the model’s', () => {
    const space = gameSpace({ width: 1024, height: 640 }, { width: 640, height: 400 })
    expect(space.unplace({ x: 120, y: 40, width: 200, height: 200 })).toEqual(area)
    const square = gameSpace({ width: 1024, height: 640 }, { width: 100, height: 100 })
    expect(square.unplace({ x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 192,
      y: 0,
      width: 640,
      height: 640,
    })
  })

  it('shifts by the edges cut off when the model’s picture has another shape', () => {
    // 1024 × 640 into a square: 192 cut off each side, 640 left across 100 pixels
    const space = gameSpace({ width: 1024, height: 640 }, { width: 100, height: 100 })
    expect(space.place({ x: 192, y: 0, width: 640, height: 640 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(space.place({ x: 0, y: 0, width: 100, height: 100 }).x).toBeLessThan(0)
  })
})
