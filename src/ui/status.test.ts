import { describe, expect, it } from 'bun:test'
import type { LineState } from '../core/planner'
import { linesSummary, percent, reasonCounts, seconds, speakerCounts, statusDetail } from './status'

function line(overrides: Partial<LineState>): LineState {
  return {
    key: 'k',
    speaker: 'mira',
    text: 'Hello.',
    english: null,
    cue: '',
    ownCue: false,
    final: false,
    status: 'ok',
    reasons: [],
    heard: null,
    accepted: false,
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

  it('says a line heard below the bar was accepted as it is', () => {
    expect(statusDetail(line({ status: 'ok', heard: 0.8, accepted: true }), 0.9)).toBe(
      'heard 80%, accepted',
    )
    expect(statusDetail(line({ status: 'ok', heard: 0.8 }), 0.9)).toBe('')
    expect(statusDetail(line({ status: 'ok', heard: 0.8, accepted: true }), 0.75)).toBe('')
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

describe('speakerCounts', () => {
  it('counts the statuses of one speaker’s lines', () => {
    const lines = [
      line({ status: 'ok' }),
      line({ status: 'weak' }),
      line({ status: 'ok' }),
      line({ speaker: 'tilda', status: 'stale' }),
    ]
    expect(speakerCounts(lines, 'mira')).toEqual({ ok: 2, weak: 1 })
  })
})

describe('linesSummary', () => {
  it('says what lines need, or that all are up to date', () => {
    expect(linesSummary({ ok: 2, weak: 1, stale: 2 })).toBe('2 stale · 1 weak')
    expect(linesSummary({ ok: 3 })).toBe('all up to date')
  })
})
