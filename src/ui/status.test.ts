import { describe, expect, it } from 'bun:test'
import type { LineState } from '../core/planner'
import { percent, reasonCounts, seconds, statusDetail } from './status'

function line(overrides: Partial<LineState>): LineState {
  return {
    key: 'k',
    speaker: 'mira',
    text: 'Hello.',
    cue: '',
    ownCue: false,
    status: 'ok',
    reasons: [],
    heard: null,
    duration: null,
    file: null,
    ...overrides,
  }
}

describe('reasonCounts', () => {
  it('counts each reason, most common first', () => {
    const lines = [
      line({ status: 'stale', reasons: ['cue'] }),
      line({ status: 'stale', reasons: ['voice', 'cue'] }),
    ]
    expect(reasonCounts(lines)).toEqual([
      ['cue', 2],
      ['voice', 1],
    ])
  })
})

describe('statusDetail', () => {
  it('names the reasons of a stale line', () => {
    expect(statusDetail(line({ status: 'stale', reasons: ['voice', 'pronunciation'] }), 0.9)).toBe(
      'voice changed, pronunciation changed',
    )
  })

  it('gives the heard share of a weak line against the project’s bar', () => {
    expect(statusDetail(line({ status: 'weak', heard: 0.93 }), 0.95)).toBe(
      'best take heard 93%, below 95%',
    )
  })

  it('names the speaker of an uncast line', () => {
    expect(statusDetail(line({ status: 'uncast' }), 0.9)).toBe('mira has no voice yet')
  })
})

describe('formatting', () => {
  it('formats shares and seconds, with a dash when unknown', () => {
    expect(percent(0.934)).toBe('93%')
    expect(percent(null)).toBe('—')
    expect(seconds(4.24)).toBe('4.2s')
    expect(seconds(null)).toBe('—')
  })
})
