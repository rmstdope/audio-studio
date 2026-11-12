import { describe, expect, test } from 'bun:test'
import {
  cameAlongLine,
  FineTuneBoardSchema,
  fineTuneCaption,
  MakeFineTunesBody,
  fineTuneHistory,
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
    expect(MakeFineTunesBody.safeParse({ count: 10, words: 'Add a cat', area }).success).toBe(true)
    expect(MakeFineTunesBody.safeParse({ count: 1, words: 'Add a cat', area: null }).success).toBe(
      true,
    )
    expect(MakeFineTunesBody.safeParse({ count: 0, words: 'x', area: null }).success).toBe(false)
    expect(MakeFineTunesBody.safeParse({ count: 11, words: 'x', area: null }).success).toBe(false)
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

describe('fineTuneHistory', () => {
  const take = (n: number, from?: { take: number | null; words: string }) => ({
    n,
    fineTunedFrom: from,
  })

  test('is the game’s own image alone when no take is chosen', () => {
    expect(fineTuneHistory([take(1)], null)).toEqual({
      steps: [{ kind: 'game' }],
      at: 0,
      undoTo: null,
    })
  })

  test('is one step for a take made from the prompt, with no undo', () => {
    const h = fineTuneHistory([take(3), take(4)], 3)
    expect(h.steps).toEqual([
      { kind: 'take', n: 3, words: null, from: 'prompt', inGame: true, after: false },
    ])
    expect(h.undoTo).toBeNull()
  })

  test('lists the chain oldest first and undoes to the step before', () => {
    const takes = [
      take(3),
      take(7, { take: 3, words: 'Add a rowing boat' }),
      take(8, { take: 7, words: 'Light the lamp' }),
    ]
    const h = fineTuneHistory(takes, 8)
    expect(h.steps.map((s) => (s.kind === 'take' ? s.n : 0))).toEqual([3, 7, 8])
    expect(h.steps[2]).toMatchObject({ inGame: true, words: 'Light the lamp', from: 'take' })
    expect(h.at).toBe(2)
    expect(h.undoTo).toBe(7)
  })

  test('keeps the steps after the one in the game, dimmed, so they can be redone', () => {
    const takes = [take(3), take(7, { take: 3, words: 'a' }), take(8, { take: 7, words: 'b' })]
    const h = fineTuneHistory(takes, 7)
    expect(h.steps.map((s) => s.kind === 'take' && [s.n, s.inGame, s.after])).toEqual([
      [3, false, false],
      [7, true, false],
      [8, false, true],
    ])
    expect(h.undoTo).toBe(3)
  })

  test('follows the newest branch from an earlier step', () => {
    const takes = [
      take(3),
      take(7, { take: 3, words: 'a' }),
      take(8, { take: 7, words: 'b' }),
      take(9, { take: 3, words: 'c' }),
    ]
    expect(fineTuneHistory(takes, 9).steps.map((s) => s.kind === 'take' && s.n)).toEqual([3, 9])
    expect(fineTuneHistory(takes, 3).steps.map((s) => s.kind === 'take' && s.n)).toEqual([3, 9])
    expect(fineTuneHistory(takes, 7).steps.map((s) => s.kind === 'take' && s.n)).toEqual([3, 7, 8])
  })

  test('ends the chain at a take that was dropped', () => {
    const takes = [take(7, { take: 3, words: 'a' }), take(8, { take: 7, words: 'b' })]
    const h = fineTuneHistory(takes, 8)
    expect(h.steps.map((s) => s.kind === 'take' && s.n)).toEqual([7, 8])
    expect(h.steps[0]).toMatchObject({ from: 'take' })
  })

  test('starts at a fine-tune of the game’s own image', () => {
    const takes = [take(5, { take: null, words: 'Add a lamp' })]
    expect(fineTuneHistory(takes, 5).steps).toEqual([
      { kind: 'take', n: 5, words: 'Add a lamp', from: 'game', inGame: true, after: false },
    ])
  })
})
