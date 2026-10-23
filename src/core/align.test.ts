import { describe, expect, it } from 'bun:test'
import { spreadWords } from './align'

describe('spreadWords', () => {
  it('spreads the shown words evenly over the clip, as narrate.py does with nothing heard', () => {
    expect(spreadWords('a b', 2)).toEqual([
      { word: 'a', start: 0, end: 1 },
      { word: 'b', start: 1, end: 2 },
    ])
  })

  it('gives one entry per space-separated word, rounded to milliseconds', () => {
    const words = spreadWords('One, two three.', 1)
    expect(words.map((w) => w.word)).toEqual(['One,', 'two', 'three.'])
    expect(words[1]).toEqual({ word: 'two', start: 0.333, end: 0.667 })
  })
})
