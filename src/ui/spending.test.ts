import { describe, expect, it } from 'bun:test'
import type { SpendingRow } from '../core/spending'
import { actText, costText, languageText, linesText, totalsLabel, whenText } from './spending'

const row = (over: Partial<SpendingRow> = {}): SpendingRow => ({
  id: 'r',
  at: '2026-10-25T14:02:00',
  part: 'act1',
  removed: false,
  language: 'en',
  model: 'drama-3',
  lines: 298,
  planned: 298,
  cost: 4.12,
  state: 'done',
  ...over,
})

describe('whenText', () => {
  it('writes the day, the month and the time of day', () => {
    expect(whenText('2026-10-25T14:02:00')).toBe('25 Oct, 14:02')
    expect(whenText('2026-01-03T09:05:00')).toBe('3 Jan, 09:05')
  })
  it('says Now for a running recording', () => {
    expect(whenText('2026-10-25T14:02:00', true)).toBe('Now')
  })
})

describe('linesText', () => {
  it('is the lines recorded for a recording that went through', () => {
    expect(linesText(row())).toEqual({ count: '298', note: null })
  })
  it('is “N of M” while running, with no note', () => {
    expect(linesText(row({ state: 'running', lines: 88, planned: 340 }))).toEqual({
      count: '88 of 340',
      note: null,
    })
  })
  it('says stopped and ended on an error beside “N of M”', () => {
    expect(linesText(row({ state: 'stopped', lines: 120, planned: 212 }))).toEqual({
      count: '120 of 212',
      note: 'stopped',
    })
    expect(linesText(row({ state: 'error', lines: 41, planned: 340 }))).toEqual({
      count: '41 of 340',
      note: 'ended on an error',
    })
  })
})

describe('costText', () => {
  it('uses the usual dollar form, and says so far while running', () => {
    expect(costText(row())).toBe('$4.12')
    expect(costText(row({ cost: 0.004 }))).toBe('under $0.01')
    expect(costText(row({ state: 'running', cost: 1.21 }))).toBe('$1.21 so far')
  })
})

describe('actText', () => {
  it('is the full title, or the id of an act no longer in the project', () => {
    const acts = [{ part: 'act1', title: 'Act I: The Lantern', total: 1, removed: false }]
    expect(actText(row(), acts)).toBe('Act I: The Lantern')
    expect(actText(row({ part: 'act9', removed: true }), acts)).toBe('act9')
  })
})

describe('totalsLabel', () => {
  it('counts recordings, singular for one, with the project’s part label', () => {
    expect(totalsLabel(9, 'Act')).toBe('All acts · 9 recordings')
    expect(totalsLabel(1, 'Act')).toBe('All acts · 1 recording')
    expect(totalsLabel(2, 'Chapter')).toBe('All chapters · 2 recordings')
  })
})

describe('languageText', () => {
  it('writes the language out in English', () => {
    expect(languageText('en')).toBe('English')
    expect(languageText('sv')).toBe('Swedish')
  })
})
