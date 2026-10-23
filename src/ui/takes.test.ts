import { describe, expect, it } from 'bun:test'
import { withTake } from './takes'

const candidates = {
  ok: true as const,
  audition: { phrase: 'New.', own: true, spoken: '[warm] New.' },
  takes: { a: 'key-a' } as Record<string, string>,
}

describe('withTake', () => {
  it('adds a take of the phrase shown', () => {
    expect(withTake(candidates, 'b', { key: 'key-b', spoken: '[warm] New.' }).takes).toEqual({
      a: 'key-a',
      b: 'key-b',
    })
  })

  it('ignores a take of a phrase no longer shown', () => {
    expect(withTake(candidates, 'b', { key: 'old', spoken: '[warm] Old.' })).toBe(candidates)
  })
})
