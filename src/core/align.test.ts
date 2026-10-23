import { describe, expect, it } from 'bun:test'
import {
  alignWords,
  heardWords,
  matchingBlocks,
  saidWords,
  spreadWords,
  type HeardWord,
} from './align'

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

/** Whisper's words, as narrate.py's tests write them. */
function words(...triples: [string, number, number][]): HeardWord[] {
  return triples.map(([word, start, end]) => ({ word, start, end }))
}

describe('alignWords (ported from narrate.py and its tests)', () => {
  it('takes Whisper’s times for an exact match', () => {
    const heard = words([' She', 0.1, 0.3], [' stops', 0.3, 0.6], [' here.', 0.7, 1.0])
    const { timed, ratio } = alignWords(['She', 'stops', 'here.'], heard, 1.2)
    expect(ratio).toBe(1)
    expect(timed).toEqual([
      { word: 'She', start: 0.1, end: 0.3 },
      { word: 'stops', start: 0.3, end: 0.6 },
      { word: 'here.', start: 0.7, end: 1.0 },
    ])
  })

  it('ignores case and punctuation', () => {
    const heard = words(['come', 0.0, 0.2], ['in', 0.2, 0.4], ['child', 0.5, 0.9])
    const { timed, ratio } = alignWords(['Come', 'in,', 'child.'], heard, 1.0)
    expect(ratio).toBe(1)
    expect(timed.map((w) => w.start)).toEqual([0.0, 0.2, 0.5])
  })

  it('spreads unheard words between their neighbours', () => {
    const heard = words(
      ['I', 0.0, 0.2],
      ['am', 0.2, 0.4],
      ['Boring', 0.5, 0.9],
      ['the', 1.0, 1.1],
      ['smith', 1.1, 1.6],
    )
    const { timed, ratio } = alignWords(['I', 'am', 'Borin,', 'the', 'smith.'], heard, 2.0)
    expect(ratio).toBeCloseTo(4 / 5, 9)
    const borin = timed[2]!
    expect(borin.word).toBe('Borin,')
    expect(borin.start).toBeGreaterThanOrEqual(0.4)
    expect(borin.start).toBeLessThan(borin.end)
    expect(borin.end).toBeLessThanOrEqual(1.0)
  })

  it('never goes backwards and stays inside the clip', () => {
    const { timed } = alignWords(['one', 'two', 'three', 'four'], words(['three', 0.9, 1.2]), 1.5)
    const starts = timed.map((w) => w.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(timed[0]!.start).toBeGreaterThanOrEqual(0)
    expect(timed.at(-1)!.end).toBeLessThanOrEqual(1.5)
  })

  it('spreads the words over the clip when nothing was heard', () => {
    const { timed, ratio } = alignWords(['a', 'b'], [], 2.0)
    expect(ratio).toBe(0)
    expect(timed[0]!.start).toBe(0)
    expect(timed.at(-1)!.end).toBe(2)
  })

  it('compares against the words as said', () => {
    const said = saidWords('Act I: The Call', { 'Act I:': 'Act One:' })
    const heard = words(['Act', 0.0, 0.3], ['1', 0.3, 0.9], ['The', 1.0, 1.2], ['Call', 1.2, 1.6])
    const { timed, ratio } = alignWords(['Act', 'I:', 'The', 'Call'], heard, 2.0, said)
    expect(ratio).toBe(1)
    expect(timed[1]).toEqual({ word: 'I:', start: 0.3, end: 0.9 })
  })

  it('lets a pronunciation change only its own phrase', () => {
    const text = 'I knew your parents. Once you are ready, I will tell you.'
    const pronounce = { 'Act I:': 'Act One:' }
    expect(saidWords(text, pronounce)).toEqual(text.split(' '))
    const heard = words(...text.split(' ').map((w, i): [string, number, number] => [w, i, i + 0.5]))
    expect(alignWords(text.split(' '), heard, 30, saidWords(text, pronounce)).ratio).toBe(1)
  })

  it('falls back to the shown words when a pronunciation changes the word count', () => {
    expect(saidWords('Malakar waits', { Malakar: 'Mala kar' })).toEqual(['Malakar', 'waits'])
  })

  it('treats a number word and its digits alike', () => {
    expect(
      alignWords(['Act', 'I:'], words(['Act', 0.0, 0.3], ['1', 0.3, 0.9]), 1.0, ['Act', 'One:'])
        .ratio,
    ).toBe(1)
    expect(
      alignWords(['three', 'words'], words(['3', 0.0, 0.3], ['words', 0.3, 0.9]), 1.0).ratio,
    ).toBe(1)
  })
})

describe('heardWords', () => {
  it('keeps a real last segment that overshoots the clip, and drops invented ones', () => {
    const segments = [
      { start: 0.0, end: 2.0, words: words(['I', 0.0, 0.5], ['knew', 0.5, 1.0]) },
      { start: 2.0, end: 3.6, words: words(['tell', 2.1, 2.8], ['you.', 2.8, 3.5]) },
      { start: 3.4, end: 3.4, words: words(['Thanks', 3.4, 3.4]) },
      { start: 3.45, end: 4.5, words: words(['for', 3.45, 4.0], ['watching', 4.0, 4.5]) },
    ]
    expect(heardWords(segments, 3.5).map((w) => w.word)).toEqual(['I', 'knew', 'tell', 'you.'])
  })
})

describe('matchingBlocks (Python’s difflib, autojunk off)', () => {
  it('finds the same blocks as SequenceMatcher', () => {
    expect(matchingBlocks(['a', 'b', 'x', 'c', 'd'], ['a', 'b', 'c', 'd'])).toEqual([
      [0, 0, 2],
      [3, 2, 2],
      [5, 4, 0],
    ])
    expect(matchingBlocks(['a', 'x', 'y', 'z', 'a', 'b'], ['a', 'b'])).toEqual([
      [4, 0, 2],
      [6, 2, 0],
    ])
  })
})
