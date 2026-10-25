import { describe, expect, it } from 'bun:test'
import type { LineState } from '../core/planner'
import { clipsInTurn, playthroughButton, playthroughLabel } from './playthrough'

function line(key: string, overrides: Partial<LineState> = {}): LineState {
  return {
    key,
    speaker: 'mira',
    text: `Line ${key}.`,
    cue: '',
    ownCue: false,
    final: false,
    status: 'ok',
    reasons: [],
    heard: null,
    accepted: false,
    duration: null,
    file: `${key}.mp3`,
    ...overrides,
  }
}

describe('clipsInTurn', () => {
  it('lists the lines with a clip, in the order shown', () => {
    const lines = [line('a'), line('b', { file: null, status: 'missing' }), line('c')]
    expect(clipsInTurn(lines)).toEqual([
      { key: 'a', file: 'a.mp3' },
      { key: 'c', file: 'c.mp3' },
    ])
  })

  it('starts from a line when asked, and from the first when that line is not shown', () => {
    const lines = [line('a'), line('b'), line('c')]
    expect(clipsInTurn(lines, 'b').map((c) => c.key)).toEqual(['b', 'c'])
    expect(clipsInTurn(lines, 'zz').map((c) => c.key)).toEqual(['a', 'b', 'c'])
  })
})

describe('playthroughLabel', () => {
  it('says how many lines will play, and that some shown have no clip', () => {
    expect(playthroughLabel(3, 3)).toBe('Play 3 lines in turn')
    expect(playthroughLabel(1, 1)).toBe('Play 1 line in turn')
    expect(playthroughLabel(2, 5)).toBe('Play 2 of 5 lines in turn')
  })
})

describe('playthroughButton', () => {
  it('offers to play the lines shown with a clip', () => {
    expect(playthroughButton(false, 3, 5)).toEqual({
      stop: false,
      label: 'Play 3 of 5 lines in turn',
    })
  })

  it('is Stop while a list plays, even when the lines shown changed to ones without a clip', () => {
    expect(playthroughButton(true, 0, 2)).toEqual({ stop: true, label: 'Stop' })
  })

  it('is absent when nothing shown has a clip and nothing plays', () => {
    expect(playthroughButton(false, 0, 2)).toBeNull()
  })
})
