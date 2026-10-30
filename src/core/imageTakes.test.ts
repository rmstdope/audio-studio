import { describe, expect, it } from 'bun:test'
import { checkImageRequest } from './imageModels'
import {
  ImageBoardSchema,
  MakeImageTakesBody,
  rightAfterDrop,
  stepRight,
  takeIsEarlier,
  takeSize,
} from './imageTakes'

describe('takeSize', () => {
  it('scales the listed shape so the longer side is 1024, in multiples of 16', () => {
    expect(takeSize({ width: 320, height: 200 })).toEqual({ width: 1024, height: 640 })
    expect(takeSize({ width: 160, height: 200 })).toEqual({ width: 816, height: 1024 })
    expect(takeSize({ width: 100, height: 100 })).toEqual({ width: 1024, height: 1024 })
  })
  it('never makes a side smaller than 16, and is always a size the generator accepts', () => {
    const size = takeSize({ width: 4000, height: 10 })
    expect(size).toEqual({ width: 1024, height: 16 })
    for (const [width, height] of [
      [320, 200],
      [160, 100],
      [1, 999],
      [640, 480],
    ] as const) {
      const s = takeSize({ width, height })
      expect(checkImageRequest({ prompt: 'x', seed: 1, ...s })).toBeNull()
    }
  })
})

describe('the board', () => {
  it('reads a board of takes and refuses a take without a number', () => {
    const take = {
      n: 1,
      seed: 7,
      model: 'flux2-klein-4b',
      width: 1024,
      height: 640,
      madeFrom: { words: 'w', style: 's', width: 320, height: 200 },
    }
    const board = ImageBoardSchema.parse({ next: 2, takes: [take] })
    expect(board.takes[0]!.seen).toBe(false)
    expect(ImageBoardSchema.safeParse({ next: 2, takes: [{ ...take, n: 0 }] }).success).toBe(false)
  })
})

describe('earlier words', () => {
  const made = { words: 'a low inn', style: 's', width: 320, height: 200 }
  it('marks a take only when the words differ', () => {
    expect(takeIsEarlier(made, 'a low inn')).toBe(false)
    expect(takeIsEarlier(made, 'a high inn')).toBe(true)
  })
})

describe('the take on the right', () => {
  const strip = [1, 3, 4, 6]
  it('steps one take along the strip and stops at its ends', () => {
    expect(stepRight(strip, 3, 1)).toBe(4)
    expect(stepRight(strip, 3, -1)).toBe(1)
    expect(stepRight(strip, 6, 1)).toBe(6)
    expect(stepRight(strip, 1, -1)).toBe(1)
  })
  it('starts at the newest take when none is on the right', () => {
    expect(stepRight(strip, null, -1)).toBe(6)
    expect(stepRight([], null, 1)).toBeNull()
  })
  it('after a drop, the next take comes right, or the previous one for the last', () => {
    expect(rightAfterDrop(strip, 3)).toBe(4)
    expect(rightAfterDrop(strip, 6)).toBe(4)
    expect(rightAfterDrop([5], 5)).toBeNull()
  })
})

describe('the request to make takes', () => {
  it('asks for 1 to 4 takes, or the retry of one', () => {
    expect(MakeImageTakesBody.safeParse({ count: 2 }).success).toBe(true)
    expect(MakeImageTakesBody.safeParse({ count: 5 }).success).toBe(false)
    expect(MakeImageTakesBody.safeParse({ count: 0 }).success).toBe(false)
    expect(MakeImageTakesBody.safeParse({ retry: 7 }).success).toBe(true)
    expect(MakeImageTakesBody.safeParse({ count: 2, retry: 7 }).success).toBe(false)
  })
})
