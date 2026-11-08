import { describe, expect, it } from 'bun:test'
import { checkPatchArea, keepArea, matchToTake, PATCH_FEATHER } from './imagePatches'
import type { Pixels } from './imagePixels'

/** A picture of one opaque colour. */
function plain(width: number, height: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i)
  return { width, height, data }
}

const alphaAt = (p: Pixels, x: number, y: number) => p.data[(y * p.width + x) * 4 + 3]!

describe('keepArea', () => {
  const edited = plain(200, 200, [10, 20, 30])
  const area = { x: 50, y: 50, width: 100, height: 100 }

  it('leaves everything outside the area transparent', () => {
    const patch = keepArea(edited, area)
    expect(alphaAt(patch, 49, 100)).toBe(0)
    expect(alphaAt(patch, 150, 100)).toBe(0)
    expect(alphaAt(patch, 100, 49)).toBe(0)
    expect(alphaAt(patch, 100, 150)).toBe(0)
  })

  it('keeps the middle of the area whole, in the colours of the edit', () => {
    const patch = keepArea(edited, area)
    const at = (100 * 200 + 100) * 4
    expect([...patch.data.subarray(at, at + 4)]).toEqual([10, 20, 30, 255])
  })

  it('fades in from the edge of the area over the soft edge', () => {
    const patch = keepArea(edited, area)
    const ramp = Array.from({ length: PATCH_FEATHER + 1 }, (_, i) => alphaAt(patch, 50 + i, 100))
    expect(ramp[0]!).toBeLessThan(20)
    expect(ramp.at(-1)).toBe(255)
    expect(ramp).toEqual([...ramp].sort((a, b) => a - b))
    expect(ramp.some((a) => a > 60 && a < 200)).toBe(true)
  })

  it('does not fade along an edge of the picture itself', () => {
    const patch = keepArea(edited, { x: 0, y: 50, width: 100, height: 100 })
    expect(alphaAt(patch, 0, 100)).toBe(255)
    expect(alphaAt(patch, 99, 100)).toBeLessThan(20)
  })

  it('still reaches whole in the middle of an area narrower than two soft edges', () => {
    const patch = keepArea(edited, { x: 50, y: 50, width: 21, height: 100 })
    expect(alphaAt(patch, 60, 100)).toBe(255)
  })

  it('does not change the edit it is given', () => {
    const before = [...edited.data]
    keepArea(edited, area)
    expect([...edited.data]).toEqual(before)
  })
})

describe('checkPatchArea', () => {
  const size = { width: 1024, height: 576 }

  it('accepts an area inside the picture', () => {
    expect(checkPatchArea({ x: 0, y: 0, width: 1024, height: 576 }, size)).toBeNull()
  })

  it('refuses an area that leaves the picture', () => {
    expect(checkPatchArea({ x: 1000, y: 0, width: 25, height: 100 }, size)).toContain('inside')
    expect(checkPatchArea({ x: -1, y: 0, width: 25, height: 100 }, size)).toContain('inside')
    expect(checkPatchArea({ x: 0, y: 500, width: 25, height: 77 }, size)).toContain('inside')
  })

  it('refuses an area too small to patch', () => {
    expect(checkPatchArea({ x: 0, y: 0, width: 7, height: 100 }, size)).toContain('too small')
  })
})

/** A picture painted by a function of the pixel's place. */
function painted(
  width: number,
  height: number,
  at: (x: number, y: number) => [number, number, number],
): Pixels {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...at(x, y), 255], (y * width + x) * 4)
  }
  return { width, height, data }
}

const rgbAt = (p: Pixels, x: number, y: number) => [
  ...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3),
]

describe('matchToTake', () => {
  const area = { x: 50, y: 50, width: 100, height: 100 }
  const take = plain(200, 200, [100, 140, 60])

  it('corrects a small drift across the whole area, the middle too', () => {
    const edited = plain(200, 200, [110, 150, 70])
    const matched = matchToTake(edited, take, area)
    expect(rgbAt(matched, 100, 100)).toEqual([100, 140, 60])
    expect(rgbAt(matched, 51, 100)).toEqual([100, 140, 60])
  })

  it('corrects a drift of the whole picture across the area, even a big one', () => {
    const edited = plain(200, 200, [60, 100, 20])
    const matched = matchToTake(edited, take, area)
    expect(rgbAt(matched, 100, 100)).toEqual([100, 140, 60])
  })

  it('leaves the middle as painted when the instruction asked for a big difference', () => {
    const edited = painted(200, 200, (x, y) =>
      x >= 50 && x < 150 && y >= 50 && y < 150 ? [20, 30, 10] : [110, 150, 70],
    )
    const matched = matchToTake(edited, take, area)
    expect(rgbAt(matched, 100, 100)).toEqual([20, 30, 10])
    // The painting outside was 10 over the take, so the side is brought down by that much.
    expect(rgbAt(matched, 50, 100)[0]!).toBeLessThan(20)
    expect(rgbAt(matched, 90, 100)[0]!).toBeGreaterThan(rgbAt(matched, 50, 100)[0]!)
  })

  it('matches an area that is not square by its own sides', () => {
    const edited = plain(400, 100, [110, 150, 70])
    const matched = matchToTake(edited, plain(400, 100, [100, 140, 60]), {
      x: 50,
      y: 40,
      width: 300,
      height: 20,
    })
    expect(rgbAt(matched, 200, 50)).toEqual([100, 140, 60])
  })

  it('matches the sky part and the grass part of a side separately', () => {
    const horizon = (c: [number, number, number], d: [number, number, number]) =>
      painted(200, 200, (_x, y) => (y < 100 ? c : d))
    const horizonTake = horizon([100, 140, 200], [100, 140, 60])
    const horizonEdited = horizon([110, 150, 210], [98, 138, 58])
    const matched = matchToTake(horizonEdited, horizonTake, area)
    expect(rgbAt(matched, 51, 60)).toEqual([100, 140, 200])
    expect(rgbAt(matched, 51, 140)).toEqual([100, 140, 60])
    // Right at the horizon each part is still matched to what lies next to it.
    expect(rgbAt(matched, 51, 99)).toEqual([100, 140, 200])
    expect(rgbAt(matched, 51, 100)).toEqual([100, 140, 60])
  })

  it('does not streak the area with something the edit painted just outside one side', () => {
    const flat = plain(300, 300, [100, 140, 200])
    const object = (x0: number, w: number, x: number, y: number): [number, number, number] =>
      y >= 150 && y < 158 && x >= x0 && x < x0 + w ? [0, 20, 100] : [103, 143, 203]
    const bounds = { x: 50, y: 50, width: 200, height: 100 }
    // A narrow object and a wide one, painted in the strip below the area; the drift is +3.
    for (const w of [24, 60]) {
      const edited = painted(300, 300, (x, y) => object(130, w, x, y))
      const matched = matchToTake(edited, flat, bounds)
      for (const y of [149, 120, 80]) {
        for (const x of [100, 140, 200]) expect(rgbAt(matched, x, y)).toEqual([100, 140, 200])
      }
    }
  })

  it('does not look past a side on the picture edge, and matches the other sides', () => {
    const edge = { x: 0, y: 50, width: 100, height: 100 }
    const edited = plain(200, 200, [110, 150, 70])
    const matched = matchToTake(edited, take, edge)
    expect(rgbAt(matched, 0, 100)).toEqual([100, 140, 60])
  })

  it('keeps an area with nothing around it as painted', () => {
    const edited = plain(64, 64, [110, 150, 70])
    const matched = matchToTake(edited, plain(64, 64, [0, 0, 0]), {
      x: 0,
      y: 0,
      width: 64,
      height: 64,
    })
    expect(rgbAt(matched, 30, 30)).toEqual([110, 150, 70])
  })

  it('matches a very small area without error', () => {
    const edited = plain(200, 200, [110, 150, 70])
    const matched = matchToTake(edited, take, { x: 90, y: 90, width: 8, height: 8 })
    expect(rgbAt(matched, 93, 93)).toEqual([100, 140, 60])
  })

  it('does not change the edited picture it was given', () => {
    const edited = plain(200, 200, [110, 150, 70])
    matchToTake(edited, take, area)
    expect(rgbAt(edited, 100, 100)).toEqual([110, 150, 70])
  })
})
