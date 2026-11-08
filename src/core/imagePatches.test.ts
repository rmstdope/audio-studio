import { describe, expect, it } from 'bun:test'
import { checkPatchArea, keepArea, PATCH_FEATHER } from './imagePatches'
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
