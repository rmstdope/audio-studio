import { describe, expect, it } from 'bun:test'
import { outcomeOf, summariseSpending, type Recording, type Running } from './spending'

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: 'r1',
  at: '2026-10-25T14:02:00.000Z',
  part: 'act1',
  language: 'en',
  model: 'drama-3',
  stage: 'draft',
  lines: 10,
  planned: 10,
  cost: 1,
  outcome: 'done',
  ...over,
})
const running = (over: Partial<Running> = {}): Running => ({
  id: 'live',
  at: '2026-10-25T15:00:00.000Z',
  part: 'act2',
  language: 'sv',
  model: 'drama-3',
  lines: 88,
  planned: 340,
  cost: 1.21,
  ...over,
})
const parts = [
  { id: 'act1', title: 'Act I: The Lantern' },
  { id: 'act2', title: 'Act II: The Road' },
]

describe('outcomeOf', () => {
  it('is stopped when cancelled, error when a line failed, else done', () => {
    expect(outcomeOf({ status: 'cancelled', failed: 0 })).toBe('stopped')
    expect(outcomeOf({ status: 'done', failed: 2 })).toBe('error')
    expect(outcomeOf({ status: 'cancelled', failed: 2 })).toBe('error')
    expect(outcomeOf({ status: 'done', failed: 0 })).toBe('done')
  })
})

describe('summariseSpending', () => {
  it('totals per act in the project order, with an all-acts total and count', () => {
    const s = summariseSpending(
      [rec({ id: 'a', part: 'act2', cost: 2.5 }), rec({ id: 'b', part: 'act1', cost: 1.25 })],
      [],
      parts,
    )
    expect(s.total).toBeCloseTo(3.75, 9)
    expect(s.count).toBe(2)
    expect(s.acts).toEqual([
      { part: 'act1', title: 'Act I: The Lantern', total: 1.25, removed: false },
      { part: 'act2', title: 'Act II: The Road', total: 2.5, removed: false },
    ])
  })

  it('lists running rows first, then the rest newest first, and counts running in the totals', () => {
    const s = summariseSpending(
      [
        rec({ id: 'old', at: '2026-10-23T09:00:00.000Z' }),
        rec({ id: 'new', at: '2026-10-25T09:00:00.000Z' }),
      ],
      [running()],
      parts,
    )
    expect(s.rows.map((r) => r.id)).toEqual(['live', 'new', 'old'])
    expect(s.rows[0]).toMatchObject({ state: 'running', lines: 88, planned: 340, cost: 1.21 })
    expect(s.count).toBe(3)
    expect(s.total).toBeCloseTo(3.21, 9)
    expect(s.acts[1]!.total).toBeCloseTo(1.21, 9)
  })

  it('puts an act no longer in the project after the project’s acts, under its id', () => {
    const s = summariseSpending([rec({ part: 'act9', cost: 4 })], [], parts)
    expect(s.acts.map((a) => a.part)).toEqual(['act1', 'act2', 'act9'])
    expect(s.acts[2]).toEqual({ part: 'act9', title: 'act9', total: 4, removed: true })
    expect(s.rows[0]!.removed).toBe(true)
  })

  it('keeps stopped and error outcomes as row states', () => {
    const s = summariseSpending([rec({ outcome: 'stopped', lines: 120, planned: 212 })], [], parts)
    expect(s.rows[0]).toMatchObject({ state: 'stopped', lines: 120, planned: 212 })
  })

  it('is empty with no recordings', () => {
    expect(summariseSpending([], [], parts)).toMatchObject({ total: 0, count: 0, rows: [] })
  })
})
