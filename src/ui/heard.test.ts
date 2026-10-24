import { describe, expect, it } from 'bun:test'
import { canCompare, markMissed } from './heard'

describe('markMissed', () => {
  it('gives the shown words, each saying whether Whisper missed it', () => {
    expect(markMissed("You know. Aren and Lysa's.", [2])).toEqual([
      { word: 'You', missed: false },
      { word: 'know.', missed: false },
      { word: 'Aren', missed: true },
      { word: 'and', missed: false },
      { word: "Lysa's.", missed: false },
    ])
  })
})

describe('canCompare', () => {
  it('offers the comparison only for a take heard below full', () => {
    expect(canCompare(0.875)).toBe(true)
    expect(canCompare(1)).toBe(false)
    expect(canCompare(null)).toBe(false)
  })
})
