import { describe, expect, it } from 'bun:test'
import { areaFromDrag, sameArea } from './imagePatchArea'

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
