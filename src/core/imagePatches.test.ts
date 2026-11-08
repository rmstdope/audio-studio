import { describe, expect, it } from 'bun:test'
import {
  checkPatchArea,
  gamePatch,
  ChoosePatchTakeBody,
  keepArea,
  MakePatchTakesBody,
  markFromArea,
  matchToTake,
  PATCH_FEATHER,
  PatchBoardSchema,
  makeAgainOf,
  overlappingPatches,
  patchBoxesOverlap,
  patchSummary,
  planRemake,
  remakeCovered,
  setAsideQuestion,
} from './imagePatches'
import type { PatchRow } from './images'
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
    const horizonEdited = horizon([110, 150, 210], [90, 130, 50])
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

  it('does not streak the area with a wide or a soft-edged thing painted just outside (a gentle tail up to the drift limit is taken as drift)', () => {
    const flat = plain(300, 300, [100, 140, 200])
    const bounds = { x: 50, y: 50, width: 200, height: 100 }
    const wide = painted(300, 300, (x, y) =>
      y >= 150 && y < 158 && x >= 60 && x < 180 ? [0, 20, 100] : [103, 143, 203],
    )
    const soft = painted(300, 300, (x, y) => {
      const dim = y >= 150 && y < 158 ? Math.max(0, 1 - Math.abs(x - 150) / 60) : 0
      return [103 - 103 * dim, 143 - 120 * dim, 203 - 100 * dim]
    })
    for (const edited of [wide, soft]) {
      const matched = matchToTake(edited, flat, bounds)
      for (const y of [149, 120, 80]) {
        for (const x of [60, 100, 130, 154, 200, 240]) {
          for (const [i, v] of rgbAt(matched, x, y).entries()) {
            expect(Math.abs(v - [100, 140, 200][i]!)).toBeLessThanOrEqual(22)
          }
        }
      }
    }
  })

  it('still meets the take at the sides when objects painted just outside cover most of a side (the sky is still the drift)', () => {
    const flat = plain(300, 300, [100, 140, 150])
    const bounds = { x: 50, y: 50, width: 200, height: 100 }
    // The edit is paler by 85 in blue everywhere; dark birds of varied tone cover 60% of the strip around the area.
    const edited = painted(300, 300, (x, y) => {
      const ring =
        x >= 42 && x < 258 && y >= 42 && y < 158 && !(x >= 50 && x < 250 && y >= 50 && y < 150)
      const bird = ring && (x >= 50 && x < 250 ? x : y) % 20 < 12
      return bird ? [(x * 7) % 60, 20 + ((x * 3) % 40), 60 + ((x * 11) % 50)] : [103, 143, 235]
    })
    const matched = matchToTake(edited, flat, bounds)
    for (const x of [60, 80, 100, 120, 140, 160, 180, 200]) {
      for (const y of [149, 140, 100]) {
        for (const [i, v] of rgbAt(matched, x, y).entries()) {
          expect(Math.abs(v - [100, 140, 150][i]!)).toBeLessThanOrEqual(6)
        }
      }
    }
  })

  it('meets the take at the sides when objects of one dark tone cover more than half of the strip around the area', () => {
    const flat = plain(300, 300, [100, 140, 150])
    const bounds = { x: 50, y: 50, width: 200, height: 100 }
    const edited = painted(300, 300, (x, y) => {
      const ring =
        x >= 42 && x < 258 && y >= 42 && y < 158 && !(x >= 50 && x < 250 && y >= 50 && y < 150)
      return ring && (x >= 50 && x < 250 ? x : y) % 20 < 12 ? [10, 10, 15] : [103, 143, 235]
    })
    const matched = matchToTake(edited, flat, bounds)
    for (const [x, y] of [
      [60, 149],
      [100, 100],
      [140, 149],
      [51, 100],
      [248, 60],
      [200, 51],
    ] as const) {
      for (const [i, v] of rgbAt(matched, x, y).entries()) {
        expect(Math.abs(v - [100, 140, 150][i]!)).toBeLessThanOrEqual(6)
      }
    }
  })

  it('meets the take at the sides when objects of one dark tone cover most (85%) of the strip around the area', () => {
    const flat = plain(300, 300, [100, 140, 150])
    const bounds = { x: 50, y: 50, width: 200, height: 100 }
    const edited = painted(300, 300, (x, y) => {
      const ring =
        x >= 42 && x < 258 && y >= 42 && y < 158 && !(x >= 50 && x < 250 && y >= 50 && y < 150)
      return ring && (x >= 50 && x < 250 ? x : y) % 20 < 17 ? [10, 10, 15] : [103, 143, 235]
    })
    const matched = matchToTake(edited, flat, bounds)
    for (const [x, y] of [
      [60, 149],
      [100, 100],
      [140, 149],
      [51, 100],
      [248, 60],
      [200, 51],
    ] as const) {
      for (const [i, v] of rgbAt(matched, x, y).entries()) {
        expect(Math.abs(v - [100, 140, 150][i]!)).toBeLessThanOrEqual(6)
      }
    }
  })

  it('meets the take at the sides when the edit shifted the sky far while the rest of the picture stayed the same', () => {
    const flat = plain(300, 300, [100, 140, 150])
    const bounds = { x: 50, y: 20, width: 150, height: 60 }
    // Sky above y=100 is paler by (22, 48, 60) in the edit; the house below is unchanged; dark birds cover a share of the strip.
    for (const share of [0, 3, 6]) {
      const edited = painted(300, 300, (x, y) => {
        if (y >= 100) return [100, 140, 150]
        const ring =
          x >= 42 && x < 208 && y >= 12 && y < 88 && !(x >= 50 && x < 200 && y >= 20 && y < 80)
        return ring && (x >= 50 && x < 200 ? x : y) % 10 < share ? [10, 10, 15] : [122, 188, 210]
      })
      const matched = matchToTake(edited, flat, bounds)
      for (const [x, y] of [
        [60, 79],
        [100, 50],
        [140, 79],
        [51, 50],
        [198, 40],
        [120, 21],
      ] as const) {
        for (const [i, v] of rgbAt(matched, x, y).entries()) {
          expect(Math.abs(v - [100, 140, 150][i]!)).toBeLessThanOrEqual(6)
        }
      }
    }
  })

  it('is not held back by a few blended places or a thin stripe the edit left alone, in a sky shifted far', () => {
    const flat = plain(300, 300, [100, 140, 150])
    const bounds = { x: 50, y: 20, width: 150, height: 60 }
    const sky: [number, number, number] = [122, 188, 210]
    const cases: ((x: number, y: number) => [number, number, number])[] = [
      // 3x3 dark birds, partly across the strip's depth, so some places average sky and bird.
      (x, y) => (x % 17 < 3 && y % 11 < 3 && y >= 12 && y < 88 ? [10, 10, 15] : sky),
      // A 3 px column the edit left as it was, in the top strip.
      (x, y) => (x >= 100 && x < 103 && y >= 12 && y < 20 ? [100, 140, 150] : sky),
    ]
    for (const at of cases) {
      const edited = painted(300, 300, (x, y) => (y >= 100 ? [100, 140, 150] : at(x, y)))
      const matched = matchToTake(edited, flat, bounds)
      for (const [x, y] of [
        [60, 79],
        [140, 79],
        [51, 50],
        [198, 40],
      ] as const) {
        for (const [i, v] of rgbAt(matched, x, y).entries()) {
          expect(Math.abs(v - [100, 140, 150][i]!)).toBeLessThanOrEqual(10)
        }
      }
    }
  })

  it('meets the take at every side when the drift changes gradually across the area', () => {
    const flat = plain(300, 300, [100, 140, 150])
    const bounds = { x: 50, y: 50, width: 200, height: 100 }
    const edited = painted(300, 300, (x) => [100, 140, 150 + Math.round(x / 5)])
    const matched = matchToTake(edited, flat, bounds)
    for (const [x, y] of [
      [51, 100],
      [248, 100],
      [240, 149],
      [60, 51],
      [150, 100],
    ] as const) {
      expect(Math.abs(rgbAt(matched, x, y)[2]! - 150)).toBeLessThanOrEqual(6)
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

describe('patchSummary', () => {
  it('says no takes yet for a patch without takes', () => {
    expect(patchSummary([])).toEqual({ text: 'no takes yet', chip: null })
  })

  it('counts takes and says none is chosen', () => {
    expect(patchSummary([{ n: 1, chosen: false }])).toEqual({
      text: '1 take, none chosen',
      chip: null,
    })
    expect(
      patchSummary([
        { n: 1, chosen: false },
        { n: 2, chosen: false },
      ]),
    ).toEqual({ text: '2 takes, none chosen', chip: null })
  })

  it('names the chosen take in a chip', () => {
    expect(
      patchSummary([
        { n: 1, chosen: true },
        { n: 2, chosen: false },
        { n: 3, chosen: false },
      ]),
    ).toEqual({ text: '3 takes', chip: 'Take 1 chosen' })
    expect(patchSummary([{ n: 4, chosen: true }])).toEqual({
      text: '1 take',
      chip: 'Take 4 chosen',
    })
  })
})

describe('the patch board and what is asked of it', () => {
  it('reads a board with a choice per image take', () => {
    const board = {
      next: 3,
      takes: [
        { n: 1, base: 3, seed: 5, words: 'no door', area: { x: 1, y: 2, width: 30, height: 40 } },
      ],
      chosen: { '3': 1 },
    }
    expect(PatchBoardSchema.parse(board).takes[0]!.seen).toBe(false)
    expect(PatchBoardSchema.parse(board).chosen).toEqual({ '3': 1 })
  })

  it("keeps what is in the game and the look of a take's game version", () => {
    const board = PatchBoardSchema.parse({
      takes: [
        {
          n: 1,
          base: 3,
          seed: 1,
          words: 'w',
          area: { x: 0, y: 0, width: 9, height: 9 },
          look: 'k',
        },
      ],
      chosen: { '3': 1 },
      inGame: { '3': 1 },
    })
    expect(board.takes[0]!.look).toBe('k')
    expect(board.inGame).toEqual({ '3': 1 })
  })

  it('starts empty', () => {
    expect(PatchBoardSchema.parse({})).toEqual({ next: 1, takes: [], chosen: {}, inGame: {} })
  })

  it('asks for one to four new takes of an area, or a failed take again', () => {
    const area = { x: 0, y: 0, width: 20, height: 20 }
    expect(MakePatchTakesBody.safeParse({ count: 2, area }).success).toBe(true)
    expect(MakePatchTakesBody.safeParse({ count: 5, area }).success).toBe(false)
    expect(MakePatchTakesBody.safeParse({ count: 0, area }).success).toBe(false)
    expect(MakePatchTakesBody.safeParse({ retry: 4 }).success).toBe(true)
    expect(MakePatchTakesBody.safeParse({ count: 2 }).success).toBe(false)
  })

  it('chooses a take by its number', () => {
    expect(ChoosePatchTakeBody.safeParse({ n: 2 }).success).toBe(true)
    expect(ChoosePatchTakeBody.safeParse({ n: 0 }).success).toBe(false)
  })
})

describe('the mark a named area gives a patch', () => {
  const size = { width: 320, height: 200 }
  it('grows the area by the feather on every side', () => {
    expect(markFromArea({ x: 100, y: 80, width: 50, height: 40 }, size, size)).toEqual({
      x: 100 - PATCH_FEATHER,
      y: 80 - PATCH_FEATHER,
      width: 50 + 2 * PATCH_FEATHER,
      height: 40 + 2 * PATCH_FEATHER,
    })
  })
  it('stops at the picture’s edges', () => {
    expect(markFromArea({ x: 0, y: 150, width: 300, height: 50 }, size, size)).toEqual({
      x: 0,
      y: 150 - PATCH_FEATHER,
      width: 320,
      height: 50 + PATCH_FEATHER,
    })
  })
  it('is large enough to make even from a very small area', () => {
    const mark = markFromArea({ x: 100, y: 100, width: 4, height: 4 }, size, size)!
    expect(checkPatchArea(mark, size)).toBeNull()
  })
  it('scales the area to a take of another size first', () => {
    expect(
      markFromArea({ x: 10, y: 10, width: 20, height: 20 }, size, { width: 640, height: 400 }),
    ).toEqual({ x: 0, y: 0, width: 20 * 2 + 20 + PATCH_FEATHER, height: 40 + 20 + PATCH_FEATHER })
  })
})

describe('gamePatch', () => {
  const look = {
    colours: {
      kind: 'palette' as const,
      palette: [
        [0, 0, 0],
        [255, 255, 255],
      ] as [number, number, number][],
    },
    dithering: 'patterned' as const,
  }
  const size = { width: 64, height: 64 }
  const base = plain(128, 128, [0, 0, 0])
  const paint = (area: { x: number; y: number; width: number; height: number }) =>
    keepArea(plain(128, 128, [255, 255, 255]), area)

  it('keeps only the dots that differ, each fully solid or fully transparent, in palette colours', () => {
    const out = gamePatch(base, paint({ x: 32, y: 32, width: 64, height: 64 }), look, size)
    expect(out.width).toBe(64)
    let solid = 0
    for (let i = 0; i < out.data.length; i += 4) {
      const a = out.data[i + 3]!
      expect(a === 0 || a === 255).toBe(true)
      if (a === 255) {
        solid++
        expect([0, 255]).toContain(out.data[i]!)
        expect(out.data[i]).toBe(out.data[i + 1]!)
      }
    }
    expect(solid).toBeGreaterThan(0)
    expect(solid).toBeLessThan(64 * 64)
  })

  it('is transparent where the area leaves the image alone', () => {
    const out = gamePatch(base, paint({ x: 32, y: 32, width: 64, height: 64 }), look, size)
    expect(alphaAt(out, 2, 2)).toBe(0)
  })

  it('shows no change when the area lies outside what the game shows', () => {
    // a wide take cropped to a square: the sides are cut off
    const wide = plain(256, 128, [0, 0, 0])
    const edge = keepArea(plain(256, 128, [255, 255, 255]), { x: 0, y: 0, width: 32, height: 128 })
    const out = gamePatch(wide, edge, look, size)
    expect([...out.data].filter((_, i) => i % 4 === 3 && out.data[i] !== 0)).toEqual([])
  })
})

describe('patches set aside', () => {
  const patch = (title: string, chosenOn: number[], chosenOnGone = false): PatchRow => ({
    id: title.toLowerCase().replace(/ /g, '-'),
    title,
    description: '',
    words: '',
    changed: false,
    gameChanged: false,
    gameWas: null,
    chosenOn,
    chosenOnGone,
    chosenArea: null,
  })
  const bread = patch('Bread taken', [2])
  const door = patch('Door open', [1, 2])
  const lamp = patch('Lamp lit', [1])
  const well = patch('Well covered', [])
  const row = (chosenTake: number | null, ...patches: PatchRow[]) => ({ chosenTake, patches })

  describe('makeAgainOf', () => {
    it('is the patches chosen on another take only, in the game’s order', () => {
      expect(makeAgainOf(row(4, bread, well, lamp)).map((p) => p.title)).toEqual([
        'Bread taken',
        'Lamp lit',
      ])
    })
    it('leaves out a patch chosen on the take in the game too', () => {
      expect(makeAgainOf(row(2, bread, door, lamp)).map((p) => p.title)).toEqual(['Lamp lit'])
    })
    it('keeps a patch whose only choice is on a dropped take, and with no take chosen', () => {
      const gone = patch('Gone', [], true)
      expect(makeAgainOf(row(4, gone, well)).map((p) => p.title)).toEqual(['Gone'])
      expect(makeAgainOf(row(null, bread)).map((p) => p.title)).toEqual(['Bread taken'])
    })
  })

  describe('setAsideQuestion', () => {
    it('asks nothing when the take in the game has no chosen patches', () => {
      expect(setAsideQuestion(row(4, bread, well), { kind: 'choose', n: 2 })).toBeNull()
      expect(setAsideQuestion(row(null, bread), { kind: 'choose', n: 2 })).toBeNull()
      expect(setAsideQuestion(row(4, well), { kind: 'unchoose' })).toBeNull()
    })
    it('names the patches that leave, in the game’s order', () => {
      expect(setAsideQuestion(row(2, bread, well, door), { kind: 'choose', n: 4 })).toEqual({
        from: 2,
        leaving: ['Bread taken', 'Door open'],
        to: 4,
        returning: [],
      })
    })
    it('names what comes back on the take chosen', () => {
      expect(setAsideQuestion(row(2, bread, door, lamp), { kind: 'choose', n: 1 })).toEqual({
        from: 2,
        leaving: ['Bread taken'],
        to: 1,
        returning: ['Door open', 'Lamp lit'],
      })
    })
    it('asks nothing when what leaves comes back on the new take', () => {
      expect(setAsideQuestion(row(2, door), { kind: 'choose', n: 1 })).toBeNull()
    })
    it('asks the same on Un-choose, with nothing coming back', () => {
      expect(setAsideQuestion(row(2, bread, door, lamp), { kind: 'unchoose' })).toEqual({
        from: 2,
        leaving: ['Bread taken', 'Door open'],
        to: null,
        returning: [],
      })
    })
    it('leaves a patch out of the Drop question when it is chosen on the take in the game too', () => {
      expect(
        setAsideQuestion(row(4, patch('Bread taken', [2, 4])), { kind: 'drop', n: 2 }),
      ).toBeNull()
    })
    it('asks on Drop about the patches set aside on that take only', () => {
      expect(setAsideQuestion(row(4, bread, door, lamp), { kind: 'drop', n: 2 })).toEqual({
        from: 2,
        leaving: ['Bread taken', 'Door open'],
        to: null,
        returning: [],
      })
      expect(setAsideQuestion(row(4, bread, well), { kind: 'drop', n: 3 })).toBeNull()
    })
  })
})

describe('overlapping chosen patches', () => {
  const box = (x: number, y: number, width = 10, height = 10) => ({ x, y, width, height })
  const patch = (title: string, chosenArea: PatchRow['chosenArea']): PatchRow => ({
    id: title.toLowerCase().replace(/ /g, '-'),
    title,
    description: '',
    words: '',
    changed: false,
    gameChanged: false,
    gameWas: null,
    chosenOn: [],
    chosenOnGone: false,
    chosenArea,
  })

  it('counts areas that share a dot, even only at a corner', () => {
    expect(patchBoxesOverlap(box(0, 0), box(9, 9))).toBe(true)
    expect(patchBoxesOverlap(box(0, 0, 100, 100), box(40, 40))).toBe(true)
  })
  it('does not count areas that only share a border, or lie apart', () => {
    expect(patchBoxesOverlap(box(0, 0), box(10, 0))).toBe(false)
    expect(patchBoxesOverlap(box(0, 0), box(10, 10))).toBe(false)
    expect(patchBoxesOverlap(box(0, 0), box(50, 50))).toBe(false)
  })
  it('lists each pair once in the game’s order, earlier patch first', () => {
    const a = patch('A', box(0, 0))
    const b = patch('B', box(5, 5))
    const c = patch('C', box(8, 8))
    const d = patch('D', box(80, 80))
    expect(overlappingPatches([a, b, d, c]).map((pair) => pair.map((p) => p.title))).toEqual([
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'C'],
    ])
  })
  it('ignores a patch with no chosen area on the take in the game', () => {
    expect(overlappingPatches([patch('A', box(0, 0)), patch('B', null)])).toEqual([])
  })
})

describe('remakeCovered', () => {
  const row = (chosenTake: number | null, patches: Partial<PatchRow>[]) => ({
    chosenTake,
    patches: patches.map((p) => ({ chosenOn: [], chosenOnGone: false, ...p }) as PatchRow),
  })
  const idle = (id: string) => ({ id, takes: [], making: [], failed: [] })

  it('covers a "Make again" patch with no takes on the take in the game', () => {
    const r = row(2, [{ id: 'a', chosenOn: [1] }, { id: 'b' }])
    expect(remakeCovered(r, [idle('a'), idle('b')]).map((p) => p.id)).toEqual(['a'])
  })

  it('leaves out a patch that has takes, takes being made, or a failed take', () => {
    const r = row(2, [
      { id: 'a', chosenOn: [1] },
      { id: 'b', chosenOn: [1] },
      { id: 'c', chosenOn: [1] },
      { id: 'd', chosenOn: [1] },
    ])
    const work = [
      { id: 'a', takes: [{}], making: [], failed: [] },
      { id: 'b', takes: [], making: [{}], failed: [] },
      { id: 'c', takes: [], making: [], failed: [{}] },
      idle('d'),
    ] as never
    expect(remakeCovered(r, work).map((p) => p.id)).toEqual(['d'])
  })

  it('covers nothing when no take of the image is chosen', () => {
    expect(remakeCovered(row(null, [{ id: 'a', chosenOn: [1] }]), [idle('a')])).toEqual([])
  })
})

describe('planRemake', () => {
  const image = { width: 640, height: 400 }
  const take = { width: 1024, height: 640 }
  const mark = { x: 10, y: 10, width: 100, height: 100 }
  const earlier = { x: 200, y: 200, width: 80, height: 80 }
  const base = { title: 'Bread taken', mark: null, tie: null, earlier: null }

  it('uses the mark the person drew first', () => {
    const tie = { title: 'Loaf', box: { x: 0, y: 0, width: 50, height: 50 } }
    const plan = planRemake([{ ...base, id: 'a', mark, tie, earlier }], image, take)
    expect(plan.make).toEqual([{ id: 'a', title: 'Bread taken', area: mark }])
  })

  it('then the place its named area has now', () => {
    const box = { x: 100, y: 100, width: 100, height: 100 }
    const plan = planRemake(
      [{ ...base, id: 'a', tie: { title: 'Loaf', box }, earlier }],
      image,
      take,
    )
    expect(plan.make[0]!.area).toEqual(markFromArea(box, image, take)!)
  })

  it('then the area the patch was chosen with, also for an area with no place', () => {
    const plan = planRemake(
      [{ ...base, id: 'a', tie: { title: 'Loaf', box: null }, earlier }],
      image,
      take,
    )
    expect(plan.make[0]!.area).toEqual(earlier)
  })

  it('names a patch with nothing to go on and makes the others', () => {
    const plan = planRemake(
      [
        { ...base, id: 'a' },
        { ...base, id: 'b', title: 'Lamp lit', earlier },
      ],
      image,
      take,
    )
    expect(plan.leftOut).toEqual([{ id: 'a', title: 'Bread taken' }])
    expect(plan.make.map((m) => m.id)).toEqual(['b'])
  })

  it('ignores a mark that does not fit the picture', () => {
    const bad = { x: 1000, y: 0, width: 100, height: 100 }
    const plan = planRemake([{ ...base, id: 'a', mark: bad, earlier }], image, take)
    expect(plan.make[0]!.area).toEqual(earlier)
  })
})
