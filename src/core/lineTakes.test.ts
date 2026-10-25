import { describe, expect, it } from 'bun:test'
import { LineTakeSchema, takesView, type LineTake } from './lineTakes'

const take = (id: string, at: string, fp: string): LineTake => ({
  version: 1,
  id,
  at,
  fp,
  model: 's2.1-pro-free',
  seconds: 1.5,
  heard: 0.9,
  timed: [{ word: 'Hi', start: 0, end: 1.5 }],
  words: ['Hi'],
  missed: [],
})

describe('takesView', () => {
  it('lists takes newest first, marking those made from today’s inputs', () => {
    const older = take('a'.repeat(16), '2026-10-25T10:00:00Z', 'old')
    const newer = take('b'.repeat(16), '2026-10-25T11:00:00Z', 'now')
    expect(takesView([older, newer], 'now')).toEqual([
      { id: 'b'.repeat(16), at: newer.at, seconds: 1.5, heard: 0.9, current: true },
      { id: 'a'.repeat(16), at: older.at, seconds: 1.5, heard: 0.9, current: false },
    ])
  })

  it('refuses a file that is not a take', () => {
    expect(LineTakeSchema.safeParse({ version: 1, id: 'short' }).success).toBe(false)
    expect(LineTakeSchema.safeParse(take('c'.repeat(16), 'now', 'f')).success).toBe(true)
  })
})
