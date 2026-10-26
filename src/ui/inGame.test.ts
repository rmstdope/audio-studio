import { describe, expect, it } from 'bun:test'
import type { LineState } from '../core/planner'
import { inGameState, recordedLinesOf } from './inGame'

function line(key: string, overrides: Partial<LineState> = {}): LineState {
  return {
    key,
    speaker: 'mira',
    text: `Line ${key}.`,
    english: null,
    cue: '[warm]',
    cueFrom: 'style',
    sourceCue: null,
    inside: [],
    insideStale: null,
    sourceInside: [],
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

describe('inGameState', () => {
  const lines = recordedLinesOf(
    [{ id: 'act1', title: 'Act I', lines: Array.from({ length: 7 }, (_, i) => line(`k${i}`)) }],
    'mira',
  )
  const parts = (...states: ('loaded' | 'pending' | 'failed')[]) =>
    states.map((state, i) => ({ id: `act${i + 1}`, title: `Act ${i + 1}`, state }))

  it('shows the first five lines, all when asked, and offers to play them once every part is in', () => {
    expect(inGameState(parts('loaded'), lines, false)).toMatchObject({
      shown: lines.slice(0, 5),
      more: 2,
      canPlayAll: true,
      loading: null,
      empty: false,
    })
    expect(inGameState(parts('loaded'), lines, true).shown).toEqual(lines)
    expect(inGameState(parts('loaded', 'pending'), lines, true)).toMatchObject({
      canPlayAll: false,
      loading: 'Loading 1 more part…',
    })
  })

  it('names the parts that could not be loaded', () => {
    expect(inGameState(parts('failed', 'loaded', 'failed'), lines, false).failed).toEqual([
      { id: 'act1', title: 'Act 1' },
      { id: 'act3', title: 'Act 3' },
    ])
  })

  it('says when nothing is recorded, but not while loading or after a failure', () => {
    expect(inGameState(parts('loaded'), [], false)).toMatchObject({ empty: true, loading: null })
    expect(inGameState(parts('pending'), [], false)).toMatchObject({
      empty: false,
      loading: 'Loading 1 part…',
    })
    expect(inGameState(parts('failed'), [], false).empty).toBe(false)
  })
})
