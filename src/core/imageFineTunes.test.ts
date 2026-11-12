import { describe, expect, test } from 'bun:test'
import {
  cameAlongLine,
  FineTuneBoardSchema,
  fineTuneCaption,
  MakeFineTunesBody,
} from './imageFineTunes'

describe('fineTuneCaption', () => {
  test('names the take and the words', () => {
    expect(fineTuneCaption(3, 'Add a black cat')).toBe('Fine-tuned from Take 3: “Add a black cat”')
  })
  test("names the game's own image", () => {
    expect(fineTuneCaption(null, 'Add a cat')).toBe(
      "Fine-tuned from the game's own image: “Add a cat”",
    )
  })
  test('shortens long words with an ellipsis', () => {
    const words = 'Add a black cat sleeping on the bed by the window and a candle on the table'
    const line = fineTuneCaption(3, words)
    expect(line).toBe(`Fine-tuned from Take 3: “${words.slice(0, 60).trimEnd()}…”`)
  })
  test('collapses line breaks in the words', () => {
    expect(fineTuneCaption(1, 'Add\n a  cat')).toBe('Fine-tuned from Take 1: “Add a cat”')
  })
})

describe('cameAlongLine', () => {
  test('names the areas and patches that came along', () => {
    expect(cameAlongLine(4, { areas: 3, patches: 1 }, 3)).toBe(
      'Take 4 is in the game now. Its 3 named areas and 1 chosen patch came along from Take 3.',
    )
  })
  test('names only what exists', () => {
    expect(cameAlongLine(4, { areas: 1, patches: 0 }, 3)).toBe(
      'Take 4 is in the game now. Its 1 named area came along from Take 3.',
    )
    expect(cameAlongLine(4, { areas: 0, patches: 2 }, 3)).toBe(
      'Take 4 is in the game now. Its 2 chosen patches came along from Take 3.',
    )
  })
  test('says only what is in the game when nothing came along', () => {
    expect(cameAlongLine(4, { areas: 0, patches: 0 }, 3)).toBe('Take 4 is in the game now.')
  })
  test("from the game's own image", () => {
    expect(cameAlongLine(1, { areas: 0, patches: 0 }, null)).toBe(
      "Take 1 is in the game now, fine-tuned from the game's own image.",
    )
  })
})

describe('MakeFineTunesBody', () => {
  const area = { x: 1, y: 2, width: 30, height: 40 }
  test('takes 1 to 6 with words, a mark or none', () => {
    expect(MakeFineTunesBody.safeParse({ count: 6, words: 'Add a cat', area }).success).toBe(true)
    expect(MakeFineTunesBody.safeParse({ count: 1, words: 'Add a cat', area: null }).success).toBe(
      true,
    )
    expect(MakeFineTunesBody.safeParse({ count: 0, words: 'x', area: null }).success).toBe(false)
    expect(MakeFineTunesBody.safeParse({ count: 7, words: 'x', area: null }).success).toBe(false)
  })
  test('refuses empty words', () => {
    expect(MakeFineTunesBody.safeParse({ count: 2, words: '  ', area: null }).success).toBe(false)
  })
  test('takes a retry', () => {
    expect(MakeFineTunesBody.safeParse({ retry: 3 }).success).toBe(true)
  })
})

describe('FineTuneBoardSchema', () => {
  test('reads an empty board', () => {
    expect(FineTuneBoardSchema.parse({})).toEqual({ next: 1, tunes: [] })
  })
  test("reads a fine-tune of the game's own image", () => {
    const board = FineTuneBoardSchema.parse({
      next: 2,
      tunes: [{ n: 1, base: 0, seed: 5, words: 'x', area: null, model: 'klein' }],
    })
    expect(board.tunes[0]?.seen).toBe(false)
  })
})
