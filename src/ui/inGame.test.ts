import { describe, expect, it } from 'bun:test'
import type { LineState } from '../core/planner'
import { afterInTurn, recordedLinesOf } from './inGame'

function line(key: string, overrides: Partial<LineState> = {}): LineState {
  return {
    key,
    speaker: 'mira',
    text: `Line ${key}.`,
    cue: '[warm]',
    ownCue: false,
    final: false,
    status: 'ok',
    reasons: [],
    heard: null,
    duration: null,
    file: `${key}.mp3`,
    ...overrides,
  }
}

describe('recordedLinesOf', () => {
  it('lists a speaker’s recorded lines, part by part in dialog order', () => {
    const parts = [
      {
        id: 'act1',
        title: 'Act I',
        lines: [line('a'), line('b', { speaker: 'tilda' }), line('c')],
      },
      { id: 'act2', title: 'Act II', lines: null },
      {
        id: 'act3',
        title: 'Act III',
        lines: [line('d', { file: null }), line('e', { status: 'weak' })],
      },
    ]
    expect(recordedLinesOf(parts, 'mira')).toEqual([
      {
        id: 'act1/a',
        part: 'act1',
        title: 'Act I',
        text: 'Line a.',
        cue: '[warm]',
        status: 'ok',
        file: 'a.mp3',
      },
      {
        id: 'act1/c',
        part: 'act1',
        title: 'Act I',
        text: 'Line c.',
        cue: '[warm]',
        status: 'ok',
        file: 'c.mp3',
      },
      {
        id: 'act3/e',
        part: 'act3',
        title: 'Act III',
        text: 'Line e.',
        cue: '[warm]',
        status: 'weak',
        file: 'e.mp3',
      },
    ])
  })
})

describe('afterInTurn', () => {
  it('gives the clip after the one that ended, and none after the last', () => {
    expect(afterInTurn(['a', 'b', 'c'], 'a')).toBe('b')
    expect(afterInTurn(['a', 'b', 'c'], 'c')).toBeNull()
    expect(afterInTurn(['a', 'b'], 'x')).toBeNull()
  })
})
