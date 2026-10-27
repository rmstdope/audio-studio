import { describe, expect, it } from 'bun:test'
import {
  outcomeOf,
  SpendingSchema,
  summariseSpending,
  type MusicSpend,
  type Recording,
  type Running,
} from './spending'

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
      { part: 'act1', title: 'Act I: The Lantern', total: 1.25, credits: 0, removed: false },
      { part: 'act2', title: 'Act II: The Road', total: 2.5, credits: 0, removed: false },
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
    expect(s.acts[2]).toEqual({ part: 'act9', title: 'act9', total: 4, credits: 0, removed: true })
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

describe('summariseSpending, ElevenLabs credits and music', () => {
  const take = (over: Partial<MusicSpend> = {}): MusicSpend => ({
    id: 'm1',
    at: '2026-10-25T16:00:00.000Z',
    part: 'act1',
    track: 'cave',
    title: 'The cave',
    model: 'eleven',
    seconds: 110,
    cost: 0.275,
    outcome: 'done',
    ...over,
  })

  it('totals dollars and credits apart, per act and in all, music takes in their act', () => {
    const s = summariseSpending(
      [
        rec({ id: 'a', cost: 0.5, credits: 1200, elevenModel: 'eleven_v3' }),
        rec({ id: 'b', part: 'act2', cost: 0, credits: 300, elevenModel: 'eleven_v3' }),
      ],
      [running({ cost: 0.25, credits: 40, elevenModel: 'eleven_v3' })],
      parts,
      [
        take(),
        take({ id: 'm2', part: 'stingers', track: 'win', title: 'Win', seconds: 10, cost: 0.025 }),
      ],
    )
    expect(s.total).toBeCloseTo(0.5 + 0.25 + 0.275 + 0.025, 9)
    expect(s.credits).toBe(1540)
    expect(s.count).toBe(3)
    expect(s.takes).toBe(2)
    expect(s.acts).toEqual([
      { part: 'act1', title: 'Act I: The Lantern', total: 0.775, credits: 1200, removed: false },
      { part: 'act2', title: 'Act II: The Road', total: 0.25, credits: 340, removed: false },
      { part: 'stingers', title: 'stingers', total: 0.025, credits: 0, removed: true },
    ])
    expect(s.rows.find((r) => r.id === 'm1')).toMatchObject({
      kind: 'music',
      track: 'The cave',
      seconds: 110,
      cost: 0.275,
      credits: 0,
      state: 'done',
    })
    expect(s.rows.find((r) => r.id === 'a')).toMatchObject({
      kind: 'narration',
      credits: 1200,
      elevenModel: 'eleven_v3',
    })
  })

  it('reads a row without credits as Fish’s alone', () => {
    const s = summariseSpending([rec()], [], parts)
    expect(s.credits).toBe(0)
    expect(s.takes).toBe(0)
    expect(s.rows[0]).toMatchObject({ kind: 'narration', credits: 0 })
  })
})

describe('SpendingSchema', () => {
  it('reads version 1, a Fish-only log, and version 2, with credits and music takes', () => {
    expect(SpendingSchema.parse({ version: 1, recordings: [rec()] })).toEqual({
      version: 1,
      recordings: [rec()],
    })
    const two = {
      version: 2 as const,
      recordings: [rec({ credits: 10, elevenModel: 'eleven_v3' })],
      music: [
        {
          id: 'm1',
          at: '2026-10-25T16:00:00.000Z',
          part: 'act1',
          track: 'cave',
          title: 'The cave',
          model: 'eleven',
          seconds: 110,
          cost: 0.275,
          outcome: 'stopped' as const,
        },
      ],
    }
    expect(SpendingSchema.parse(two)).toEqual(two)
  })
})
