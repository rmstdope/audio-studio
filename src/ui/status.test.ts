import { describe, expect, it } from 'bun:test'
import type { LineState } from '../core/planner'
import {
  linesSummary,
  partLinesSummary,
  percent,
  reasonCounts,
  seconds,
  speakerCounts,
  statusDetail,
} from './status'

function line(overrides: Partial<LineState>): LineState {
  return {
    key: 'k',
    speaker: 'mira',
    text: 'Hello.',
    english: null,
    cue: '',
    cueFrom: 'style',
    scene: null,
    followsScene: false,
    sourceCue: null,
    inside: [],
    insideStale: null,
    sourceInside: [],
    final: false,
    unspokenCues: null,
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

  it('names the language an uncast line lacks a voice in, in a project with several', () => {
    expect(statusDetail(line({ status: 'uncast', speaker: 'grandmother' }), 0.9, 'Svenska')).toBe(
      'Grandmother has no Svenska voice yet',
    )
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

  it('never calls uncast or untranslated lines up to date', () => {
    expect(linesSummary({ uncast: 1 })).toBe('1 uncast')
    expect(linesSummary({ untranslated: 6 })).toBe('6 not translated')
    expect(linesSummary({ ok: 2, missing: 1, uncast: 2, untranslated: 3 })).toBe(
      '1 missing · 2 uncast · 3 not translated',
    )
  })
})

describe('partLinesSummary', () => {
  it('says none recorded when every line is uncast or untranslated, so none can be recorded', () => {
    expect(partLinesSummary({ uncast: 3 })).toBe('none recorded')
    expect(partLinesSummary({ uncast: 2, untranslated: 1 })).toBe('none recorded')
    expect(partLinesSummary({ untranslated: 1 })).toBe('none recorded')
  })

  it('counts the up-to-date lines, or says all are', () => {
    expect(partLinesSummary({ ok: 18, stale: 2 })).toBe('18 up to date')
    expect(partLinesSummary({ ok: 1, uncast: 2 })).toBe('1 up to date')
    expect(partLinesSummary({ ok: 3 })).toBe('all up to date')
    expect(partLinesSummary({ ok: 3, untranslated: 1 })).toBe('3 up to date')
    expect(partLinesSummary({ weak: 2 })).toBe('0 up to date')
    expect(partLinesSummary({ missing: 14 })).toBe('0 up to date')
  })
})
