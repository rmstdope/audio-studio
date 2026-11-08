import { describe, expect, it } from 'bun:test'
import { areaFromDrag, sameArea } from './imagePatchArea'
import { gameSpace } from './patchGameSpace'

const box = { left: 100, top: 50, width: 512, height: 288 }
const take = { width: 1024, height: 576 }

describe('areaFromDrag', () => {
  it("gives the dragged box in the take's own pixels", () => {
    expect(areaFromDrag({ x: 110, y: 60 }, { x: 210, y: 110 }, box, take)).toEqual({
      x: 20,
      y: 20,
      width: 200,
      height: 100,
    })
  })

  it('does not care which way the drag went', () => {
    expect(areaFromDrag({ x: 210, y: 110 }, { x: 110, y: 60 }, box, take)).toEqual(
      areaFromDrag({ x: 110, y: 60 }, { x: 210, y: 110 }, box, take),
    )
  })

  it('stops at the edges of the picture', () => {
    expect(areaFromDrag({ x: 0, y: 0 }, { x: 9000, y: 9000 }, box, take)).toEqual({
      x: 0,
      y: 0,
      width: 1024,
      height: 576,
    })
  })

  it('counts a drag that starts or stops a few screen pixels inside an edge as reaching it', () => {
    expect(areaFromDrag({ x: 102, y: 52 }, { x: 609, y: 335 }, box, take)).toEqual({
      x: 0,
      y: 0,
      width: 1024,
      height: 576,
    })
  })

  it('keeps a side further inside the edge than that where it was dragged', () => {
    expect(areaFromDrag({ x: 105, y: 55 }, { x: 606, y: 332 }, box, take)).toEqual({
      x: 10,
      y: 10,
      width: 1002,
      height: 554,
    })
  })

  it('counts a side exactly at the reach as on the edge', () => {
    expect(areaFromDrag({ x: 104, y: 54 }, { x: 608, y: 334 }, box, take)).toEqual({
      x: 0,
      y: 0,
      width: 1024,
      height: 576,
    })
  })

  describe('on the game picture, which crops the take', () => {
    const space = gameSpace(take, { width: 640, height: 400 })
    const shown = { left: 0, top: 0, width: 640, height: 400 }
    const drag = (start: { x: number; y: number }, end: { x: number; y: number }) =>
      areaFromDrag(start, end, shown, space, space.unplace, take)

    it("carries a side on the game picture's edge out to the take's own edge", () => {
      expect(drag({ x: 2, y: 2 }, { x: 638, y: 398 })).toEqual({
        x: 0,
        y: 0,
        width: 1024,
        height: 576,
      })
    })

    it('keeps a side away from the edges where the game picture has it', () => {
      const inner = space.unplace({ x: 100, y: 100, width: 300, height: 200 })
      expect(drag({ x: 100, y: 100 }, { x: 400, y: 300 })).toEqual(inner)
      expect(drag({ x: 100, y: 100 }, { x: 638, y: 300 })).toEqual({
        ...inner,
        width: 1024 - inner.x,
      })
    })
  })

  it('gives nothing for a click or a drag too small to patch', () => {
    expect(areaFromDrag({ x: 110, y: 60 }, { x: 110, y: 60 }, box, take)).toBeNull()
    expect(areaFromDrag({ x: 110, y: 60 }, { x: 112, y: 160 }, box, take)).toBeNull()
  })
})

describe('sameArea', () => {
  const area = { x: 1, y: 2, width: 30, height: 40 }
  it('tells whether two areas are the same box', () => {
    expect(sameArea(area, { ...area })).toBe(true)
    expect(sameArea(area, { ...area, x: 2 })).toBe(false)
    expect(sameArea(area, null)).toBe(false)
  })
})
